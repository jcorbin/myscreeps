type Point = {
    x: number;
    y: number;
}

type DebugLevel = number | {[what: string]: number};

interface Memory {
    debug: DebugLevel;
    notes: {[id: string]: number};
}

interface CreepMemory {
    lastActed?: number
    debug: DebugLevel;
    task?: Task;
}

interface PowerCreepMemory {
    debug: DebugLevel;
}

interface RoomMemory {
    debug: DebugLevel;
}

interface SpawnMemory {
    debug: DebugLevel;
}

interface FlagMemory {
    debug: DebugLevel;
}

type ReqSpecs<T extends string> = (T|[T, number])[];

type TaskRequirements = {
    range?: number;
    moveRate?: number;
    parts?: ReqSpecs<BodyPartConstant>;
    capacity?: number|ReqSpecs<ResourceConstant>;
    resources?: ReqSpecs<ResourceConstant>;
};

type Scored = {
    scoreFactors?: {[name: string]: number};
    score?: number;
};

type Taskable = (
    | Task
    | (() => TaskResult|null|undefined)
);

type Task = (
    | ActionTask
    | MentalTask
    | SleepTask
    | TimedTask
    | TimeoutTask
    | LoopTask
);

// TimedTask is a wrapper task that adds Game.time tracking around execution of
// its inner then.ok task; if then.ok is not defined, TimedTask simply yields.
type TimedTask = {
    time: {
        init: number; // task creation time
        cont: number; // last continue time
        exec: number; // last execution time
    } | number; // alias provides init time
} & TaskMeta;

// TimeoutTask is a wrapper task that adds deadline tracking around its inner
// then.ok task; if then.ok is not defined, TimeoutTask simply yields.
type TimeoutTask = (
    | {deadline: number} // absolute game time
    | {timeout: number}  // relative to first executed tick
) & TaskMeta;

// SleepTask yields until a future time.
type SleepTask = {
    sleep: (
        | {until: number} // absolute game time
        | {ticks: number} // relative to first executed tick
        | number // alias for {ticks: number}
    );
} & TaskMeta;

type ActionTask = (
    | BuildTask
    | HarvestTask
    | TransferTask
    | UpgradeControllerTask
    | PickupTask
    | WanderTask
);

type MentalTask = (
    | ReviewTask
    | SeekTask
);

type TaskMeta = Scored & {
    // then specifies subsequent task(s) to be executed in relation to a
    // containing task's execution:
    // - an "ok" task to execute when the containing task succeeds
    // - a "fail" task to execute otherwise
    // - both "ok" and "fail" taksk are optional, but at least one must be
    //   specified if the then field is defined
    // - as a convenient shorthand, if only an "ok" task is necessary, it may
    //   be assigned directly to the then field
    //
    // Execution semantics are up to each particular task implementation,
    // allowing other control flow semantics like looping tasks or search
    // tasks, which may choose to execute any defined then tasks 0, 1 or many
    // times and perhaps in a subordinate manner, rather than passing control
    // flow to them.
    //
    // Normative execution semantics are to resolve TaskResult.nextTask when
    // task execution returns a result (does not yield by retuning null):
    // - if the task continues (by returning a result with a nextTask field)
    //   append the task's then clause; i.e. "then is deferred until after any
    //   continuation chain finishes"
    // - otherwise the task result has its nextTask field populated by any
    //   appropriate then choice; i.e. "execution may continue to a relevant
    //   then branch"
    // - all concrete ActionTasks use normative semantics
    //
    // When executing a then-task subordinately (subtask execution), such
    // execution may either happen in-place or on an instanced copy of the
    // then-task: when executing in place, any sub-continuation tasks replace
    // it; whereas instantiation first copies the task, allowing things like
    // future re-runs of a then-task.
    //
    // Wrapper execution semantics are to run then.ok as an in-place subtask:
    // - if the task continues, its nextTask replaces then.ok, and the (newly
    //   modified) containing task replaces result.nextTask
    // - if the task terminates with a failure, execution continues to
    //   then.fail if defined
    // - additional semantics may be added by the wrapper task
    // - for example see TimedTask and TimeoutTask
    //
    // On the other hand looping tasks run then.ok as an instanced subtask, 0 or
    // more times, before continuing to their then.fail task.
    then?: TaskThen;

    // optional operand passed into task execution
    arg?: TaskArg;
};

type TaskArg = (
    // prior result
    | {result: TaskResult}
    // task operand for certain kinds of higher level thought (e.g. seek -> plan -> assign)
    | {task: Task}
);

type TaskArgTypes = (
    | TaskResult
    | Task
);

type TaskThen = (
    | Task // same as {ok: Task}
    | {ok: Task}
    | {fail: Task}
    | {ok: Task; fail: Task}
);

// TaskSub provides standardized storage for instanced sub-tasks, typically
// populated from TaskMeta.then task data; see TaskMeta.then above for detail
// on how this may be used.
type TaskSub = {
    sub?: {[name: string]: Task};
};

// TaskResult represents completion of a Task, successful or failed.
type TaskResult = {
    // ok is true only if the task succeeded
    ok: boolean;

    // reason contains a description of any failure, and may provide flavor to
    // successful results.
    reason: string;

    code?: ScreepsReturnCode;

    // deadline, if defined, indicates that this (presumably failed) result was
    // due to an expired deadline. This field is meaningless if set on an
    // ok=true result, and also redundant, since the producer can just as well
    // change any remaining nextTask.deadline.
    deadline?: number;

    // nextTask indicates that task execution continues in another task.
    // The caller may execute a nextTask in either the current tick or a future
    // one at its discretion.
    nextTask?: Task;
};

// LoopTask runs its then.ok (body task) many times, breaking and continuing to
// its then.fail task only after its predicate becomes false (resp true for
// until loops).
//
// Loops with a do* predicate execute their body task at least once, and their
// predicate is allowed to check result properties like ok and code. Other
// loops like while and until may never run their body task, since they check
// their predicate before every potential body execution.
//
// The until and doUntil loop prediates are conveniences equivalent to {while:
// {not: ...}} and {doWhile: {not: ...}} respectively
type LoopTask = {
    rounds?: number; // counts body task instances
} & (
    | {while: LoopPredicate}
    | {until: LoopPredicate}
    | {doWhile: LoopDoPredicate}
    | {doUntil: LoopDoPredicate}
) & TaskMeta & TaskSub;

type LoopPredicate = BooleanAlgebra<LoopClause | CreepClause>;
type LoopDoPredicate = BooleanAlgebra<LoopClause | CreepClause | ResultClause>;

// Loop predicate clauses that rely only on loop state.
type LoopClause = (
    | {minRounds: number}
    | {maxRounds: number}
);

// Loop predicate clauses that may check result state, used only by do* family
// loop that execute body before checking predicate.
type ResultClause = (
    | {ok: boolean}
    | {code: ScreepsReturnCode}
);

// Loop predicate clauses that integrate with creep state.
type CreepClause = (
    | {full: ResourceConstant}
    | {empty: ResourceConstant}
);

// A general boolean algebra for composing branch predicates from some base
// clause type.
type BooleanAlgebra<Clause> = (
    | Clause
    | {and: BooleanAlgebra<Clause>[]}
    | {or: BooleanAlgebra<Clause>[]}
    | {not: BooleanAlgebra<Clause>}
);

// ThinkTask represents computation work that only affects memory.
// Only the CPU limit affects how many such tasks may execute per-creep-tick.
type ThinkTask<Thought extends string> = {
    think: Thought;
} & TaskMeta;

// ReviewTask implements observability during and after task execution.
type ReviewTask = ThinkTask<"review">;

// SeekTask is a "looking for work" task, causing the creep to look for
// other tasks to do.
type SeekTask = ThinkTask<"seek">;

// DoTask represents concrete action that affects the shared world.
// There are categorical limits concerning which actions may be concurrently
// performed per-creep-tick; TODO afford such limits, see docs for now.
type DoTask<Action extends string> = {
    do: Action;
} & TaskMeta;

type TargetedTask<T extends RoomObject> = {
    targetId: Id<T>;
};

// build(target: ConstructionSite): CreepActionReturnCode | ERR_NOT_ENOUGH_RESOURCES | ERR_RCL_NOT_ENOUGH;
type BuildTask = DoTask<"build"> & TargetedTask<ConstructionSite>;

// harvest(target: Source | Mineral | Deposit): CreepActionReturnCode | ERR_NOT_FOUND | ERR_NOT_ENOUGH_RESOURCES;
type HarvestTask = DoTask<"harvest"> & TargetedTask<Source | Mineral | Deposit>;

// transfer(target: AnyCreep | Structure, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;
type TransferTask = DoTask<"transfer"> & TargetedTask<AnyCreep | Structure> & {
    resourceType: ResourceConstant;
    amount?: number;
};

// withdraw(target: Structure | Tombstone | Ruin, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;
// TODO WithdrawTask similar to TransferTask

// upgradeController(target: StructureController): ScreepsReturnCode;
type UpgradeControllerTask = DoTask<"upgradeController"> & TargetedTask<StructureController>;

// pickup(target: Resource): CreepActionReturnCode | ERR_FULL;
type PickupTask = DoTask<"pickup"> & TargetedTask<Resource>;

// drop(resourceType: ResourceConstant, amount?: number): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NOT_ENOUGH_RESOURCES;
// TODO DropTask

// attackController(target: StructureController): CreepActionReturnCode;
// claimController(target: StructureController): CreepActionReturnCode | ERR_FULL | ERR_GCL_NOT_ENOUGH;
// generateSafeMode(target: StructureController): CreepActionReturnCode;
// reserveController(target: StructureController): CreepActionReturnCode;
// signController(target: StructureController, text: string): OK | ERR_BUSY | ERR_INVALID_TARGET | ERR_NOT_IN_RANGE;
// TODO more controller tasks

// dismantle(target: Structure): CreepActionReturnCode;
// repair(target: Structure): CreepActionReturnCode | ERR_NOT_ENOUGH_RESOURCES;
// TODO general structure tasks like dismantle and repair

// attack(target: AnyCreep | Structure): CreepActionReturnCode;
// rangedAttack(target: AnyCreep | Structure): CreepActionReturnCode;
// rangedMassAttack(): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NO_BODYPART;
// TODO basic combat tasks

// heal(target: AnyCreep): CreepActionReturnCode;
// rangedHeal(target: AnyCreep): CreepActionReturnCode;
// TODO healer tasks

// move(target: Creep): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NOT_IN_RANGE | ERR_INVALID_ARGS;
// pull(target: Creep): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_INVALID_TARGET | ERR_NOT_IN_RANGE | ERR_NO_BODYPART;
// TODO tasks for pull and be-pulled

// moveByPath(path: PathStep[] | RoomPosition[] | string): CreepMoveReturnCode | ERR_NOT_FOUND | ERR_INVALID_ARGS;
// TODO planned movement task

// moveTo(target: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND;
// moveTo(x: number, y: number, opts?: MoveToOpts): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET;
// TODO targeted movement task

// move(direction: DirectionConstant): CreepMoveReturnCode;
// TODO directional movement task

// suicide(): OK | ERR_NOT_OWNER | ERR_BUSY;
// TODO suicide task

// WanderTask causes a creep to move randomly.
type WanderTask = DoTask<"wander"> & {
    reason: string;
};
