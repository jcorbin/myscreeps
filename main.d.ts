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
    task?: AssignedTask;
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

type AssignedTask = Task & {
    assignTime: number;
};

type Scored = {
    scoreFactors?: {[name: string]: number};
    score?: number;
};

type Taskable = (
    | Task
    | (() => TaskResult|null)
);

type Task = (
    | ActionTask
);

type ActionTask = (
    | BuildTask
    | HarvestTask
    | TransferTask
    | UpgradeControllerTask
    | PickupTask
    | WanderTask
);

type TaskMeta = Scored & {
    // deadline is an optional future game tick after which this task should no
    // longer execute
    deadline?: number;

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
    then?: TaskThen;
};

type TaskThen = (
    | Task // same as {ok: Task}
    | {ok: Task}
    | {fail: Task}
    | {ok: Task; fail: Task}
);

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

// DoTask represents concrete action that affects the shared world.
// There are categorical limits concerning which actions may be concurrently
// performed per-creep-tick; TODO afford such limits, see docs for now.
type DoTask<Action extends string> = {
    do: Action;
    repeat?: {
        whileCode?: ScreepsReturnCode;
        untilCode?: ScreepsReturnCode;
        untilFull?: ResourceConstant;
        untilEmpty?: ResourceConstant;
    };
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
