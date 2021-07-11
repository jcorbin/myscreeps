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
    wanderingFor?: number;
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

// Task represents a single unit of creep work.
type Task = (
    | DoTask
    | WanderTask
) & Scored & {
    deadline?: number;
};

// TaskResult represents completion of a Task, successful or failed.
type TaskResult = {
    // ok is true only if the task succeeded
    ok: boolean;

    // reason contains a description of any failure, and may provide flavor to
    // successful results.
    reason: string;

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
type DoTask = (
    | BuildTask
    | HarvestTask
    | TransferTask
    | UpgradeControllerTask
    | PickupTask
) & {
    repeat?: {
        untilCode?: ScreepsReturnCode;
        untilFull?: ResourceConstant;
        untilEmpty?: ResourceConstant;
    };
};

type TargetedTask<T extends RoomObject> = {
    targetId: Id<T>;
};

type BuildTask = TargetedTask<ConstructionSite> & {
    // build(target: ConstructionSite): CreepActionReturnCode | ERR_NOT_ENOUGH_RESOURCES | ERR_RCL_NOT_ENOUGH;
    do: "build";
}

type HarvestTask = TargetedTask<Source | Mineral | Deposit> & {
    // harvest(target: Source | Mineral | Deposit): CreepActionReturnCode | ERR_NOT_FOUND | ERR_NOT_ENOUGH_RESOURCES;
    do: "harvest";
}

type TransferTask = TargetedTask<AnyCreep | Structure> & {
    // transfer(target: AnyCreep | Structure, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;
    do: "transfer";
    resourceType: ResourceConstant;
    amount?: number;
}

// TODO WithdrawTask similar to TransferTask
// withdraw(target: Structure | Tombstone | Ruin, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;

type UpgradeControllerTask = TargetedTask<StructureController> & {
    // upgradeController(target: StructureController): ScreepsReturnCode;
    do: 'upgradeController';
}

type PickupTask = TargetedTask<Resource> & {
    // pickup(target: Resource): CreepActionReturnCode | ERR_FULL;
    do: "pickup";
}

// TODO DropTask
// drop(resourceType: ResourceConstant, amount?: number): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NOT_ENOUGH_RESOURCES;

// TODO more controller tasks
// attackController(target: StructureController): CreepActionReturnCode;
// claimController(target: StructureController): CreepActionReturnCode | ERR_FULL | ERR_GCL_NOT_ENOUGH;
// generateSafeMode(target: StructureController): CreepActionReturnCode;
// reserveController(target: StructureController): CreepActionReturnCode;
// signController(target: StructureController, text: string): OK | ERR_BUSY | ERR_INVALID_TARGET | ERR_NOT_IN_RANGE;

// TODO general structure tasks like dismantle and repair
// dismantle(target: Structure): CreepActionReturnCode;
// repair(target: Structure): CreepActionReturnCode | ERR_NOT_ENOUGH_RESOURCES;

// TODO basic combat tasks
// attack(target: AnyCreep | Structure): CreepActionReturnCode;
// rangedAttack(target: AnyCreep | Structure): CreepActionReturnCode;
// rangedMassAttack(): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NO_BODYPART;

// TODO healer tasks
// heal(target: AnyCreep): CreepActionReturnCode;
// rangedHeal(target: AnyCreep): CreepActionReturnCode;

// TODO tasks for pull and be-pulled
// move(target: Creep): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_NOT_IN_RANGE | ERR_INVALID_ARGS;
// pull(target: Creep): OK | ERR_NOT_OWNER | ERR_BUSY | ERR_INVALID_TARGET | ERR_NOT_IN_RANGE | ERR_NO_BODYPART;

// TODO planned movement task
// moveByPath(path: PathStep[] | RoomPosition[] | string): CreepMoveReturnCode | ERR_NOT_FOUND | ERR_INVALID_ARGS;

// TODO targeted movement task
// moveTo(target: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND;
// moveTo(x: number, y: number, opts?: MoveToOpts): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET;

// TODO directional movement task
// move(direction: DirectionConstant): CreepMoveReturnCode;

// TODO suicide task
// suicide(): OK | ERR_NOT_OWNER | ERR_BUSY;

// WanderTask is a special task, used as default idle behavior, which causes
// random movement: when a creep has no task available, it takes a WanderTask
// with a deadline of 5-15 steps. A wandering creep also counts how many total
// ticks it has wandered for. After this count exceeds 30 ticks, the creep
// disposes of itself; currently this means immediate suicide, but may
// eventually involve recycling.
type WanderTask = {
    wander: string; // reason
}
