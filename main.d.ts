type Point = {
    x: number;
    y: number;
}

interface Memory {
    notes: {[id: string]: number};
}

interface CreepMemory {
    task?: AssignedTask;
    wanderingFor?: number;
}

type AssignedTask = Task & {
    assignTime: number;
};

// Task represents a single unit of creep work.
type Task = {
    score: number;
    deadline?: number;
} & (
    | DoTask
    | WanderTask
);

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

type BuildTask = {
    // build(target: ConstructionSite): CreepActionReturnCode | ERR_NOT_ENOUGH_RESOURCES | ERR_RCL_NOT_ENOUGH;
    do: "build";
    targetId: Id<ConstructionSite>;
}

type HarvestTask = {
    // harvest(target: Source | Mineral | Deposit): CreepActionReturnCode | ERR_NOT_FOUND | ERR_NOT_ENOUGH_RESOURCES;
    do: "harvest";
    targetId: Id<Source | Mineral | Deposit>;
}

type TransferTask = {
    // transfer(target: AnyCreep | Structure, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;
    do: "transfer";
    targetId: Id<AnyCreep | Structure>;
    resourceType: ResourceConstant;
    amount?: number;
}

// TODO WithdrawTask similar to TransferTask
// withdraw(target: Structure | Tombstone | Ruin, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;

type UpgradeControllerTask = {
    // upgradeController(target: StructureController): ScreepsReturnCode;
    do: 'upgradeController';
    targetId: Id<StructureController>;
}

type PickupTask = {
    // pickup(target: Resource): CreepActionReturnCode | ERR_FULL;
    do: "pickup";
    targetId: Id<Resource>;
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

type WanderTask = {
    wander: string; // reason
}
