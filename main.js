// @ts-check

// TODO better if we can get room size from platform
const ROOM_WIDTH = 50;
const ROOM_HEIGHT = 50;
const ROOM_QUAD = ROOM_WIDTH * ROOM_HEIGHT;

const minRoomCreeps = 2;
const minSpawnProgressP = 0.1;
const wanderFor = 10;

/** @type {DirectionConstant[]} */
const moveDirections = [
    TOP,
    TOP_RIGHT,
    RIGHT,
    BOTTOM_RIGHT,
    BOTTOM,
    BOTTOM_LEFT,
    LEFT,
    TOP_LEFT,
];

class Agent {
    loop() {
        this.extend({
            debugLevelCache: {},
            findCache: {},
        }).tick();
    }

    /**
     * @param {Partial<Agent>} props
     * @returns {Agent}
     */
    extend(props) {
        const self = /** @type {Agent} */ (Object.create(this));
        Object.assign(self, props);
        return self;
    }

    tick() {
        for (const room of Object.values(Game.rooms)) {
            // TODO collect room.getEventLog
            this.reapCreepsIn(room);
            this.spawnCreepsIn(room);
        }

        for (const creep of Object.values(Game.creeps)) {
            this.runCreep(creep);
        }

        // forget any creeps that we didn't reap above
        for (const [name, mem] of Object.entries(Memory.creeps)) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
                logCreep('👻', name, JSON.stringify(mem));
            }
        }

        // forget powerCreeps
        // TODO do we properly reap powerCreeps
        for (const [name, mem] of Object.entries(Memory.powerCreeps)) {
            if (!Game.powerCreeps[name]) {
                delete Memory.powerCreeps[name];
                logPowerCreep('👻', name, JSON.stringify(mem));
            }
        }

        // forget rooms
        for (const [name, mem] of Object.entries(Memory.rooms)) {
            if (!Game.rooms[name]) {
                // TODO maybe archive for later?
                delete Memory.rooms[name];
                logRoom('👻', name, JSON.stringify(mem));
            }
        }

        // forget spawns
        for (const [name, mem] of Object.entries(Memory.spawns)) {
            if (!Game.spawns[name]) {
                delete Memory.spawns[name];
                logSpawn('👻', name, JSON.stringify(mem));
            }
        }

        // forget flags
        for (const [name, mem] of Object.entries(Memory.flags)) {
            if (!Game.flags[name]) {
                delete Memory.flags[name];
                logFlag('👻', name, JSON.stringify(mem));
            }
        }

        // TODO forget flags

        // forget notes once their object is gone
        for (const id of Object.keys(Memory.notes)) {
            if (!Game.getObjectById(/** @type {Id<any>} */ (id)))
                delete Memory.notes[id];
        }
    }

    /** @param {Room} room */
    reapCreepsIn(room) {
        for (const {id, creep, deathTime} of this.find(room, FIND_TOMBSTONES)) {
            if (!creep.my) continue;
            if (note(id)) {
                this.reapCreep(creep, deathTime);
                // TODO post a room job to collect any storage within ticksToDecay
            }
        }
    }

    /** @param {Room} room */
    spawnCreepsIn(room) {
        for (const {spawn, parts, name} of bestChoice(this.designCreepsIn(room))) {
            const res = spawn.spawnCreep(parts, name); // TODO support energyStructures
            if (res == OK) {
                if (this.debugLevel('spawnCreep', spawn) > 0) {
                    logSpawn('⨁', spawn.name, parts, name);
                }
                break; // TODO more than one?
            } else {
                logSpawn('⚠️', spawn.name, parts, name, res);
            }
        }
    }

    /** @param {Room} room */
    *designCreepsIn(room) {
        for (const spawn of this.find(room, FIND_MY_SPAWNS)) {
            if (spawn.spawning) continue;

            /** @param {number} energy */
            const plan = energy => {
                const resources = fromEntries([
                    [RESOURCE_ENERGY, energy],
                ]);
                const env = {room, spawn};
                const design = this.buildCreepDesign(new CreepDesign(resources, {env}));
                return design ? design.result : null;
            };

            // plan designs for what we can afford right now and ideally
            const {energyAvailable, energyCapacityAvailable} = room;
            const may = plan(energyAvailable);
            if (!may) continue;
            const could = energyAvailable < energyCapacityAvailable ? plan(energyCapacityAvailable) : null;

            const progress = ((may, could) => {
                if (!may) return 0;
                if (!could) return 1;
                return Object.entries(could)
                    .map(([resource, n]) => (may[resource] || 0) / n)
                    .reduce(nanMin, NaN);
            })(may && may.resources, could && could.resources);
            const progressScore = normalScore(progress, minSpawnProgressP, 1);

            // TODO factor capability novelty, demand, (dis)advantage vs peers
            const vsScore = (Array.from(this.find(room, FIND_MY_CREEPS)).length < minRoomCreeps) ? 1 : 0;

            // TODO factor in estimated wait time
            // TODO factor in spawn preference/advantage
            const score = Math.max(progressScore, vsScore);

            const {name: designName, parts, ...extra} = may;
            if (parts.length) {
                const name = `${designName} T${Game.time}`;
                yield {spawn, score, name, parts, ...extra};
            }
        }
    }

    /**
     * @param {CreepDesign} design
     */
    buildCreepDesign(design) {
        design.entries.push(['name', 'Worker']);
        for (const part of [MOVE, WORK, CARRY]) {
            if (!design.produce(part)) return null;
        }
        while (true) {
            for (const part of [MOVE, WORK, MOVE, CARRY]) {
                if (!design.produce(part)) return design;
            }
        }
    }

    /**
     * @param {AnyCreep} creep
     * @param {number} deathTime
     */
    reapCreep(creep, deathTime) {
        // TODO use deathTime to explain death from room.getEventLog collection

        // TODO only if (creep.my) ?

        if (creep instanceof Creep) {
            // TODO provide evolution feedback
            const {name, body} = creep;
            const partCounts = Array.from(uniq(
                body
                .map(({type}) => type)
                .sort()
            ));
            const mem = Memory.creeps[name];
            delete Memory.creeps[name];
            logCreep('💀', name, JSON.stringify({deathTime, partCounts, mem}));
        }

        // TODO creep instanceof PowerCreep
    }

    /**
     * @param {Creep} creep
     * @param {string} reason
     */
    disposeCreep(creep, reason) {
        // TODO task to recycle at nearest spawn
        this.killCreep(creep, reason);
    }

    /**
     * @param {Creep} creep
     * @param {string} reason
     */
    killCreep(creep, reason) {
        const err = creep.suicide();
        if (err === OK) {
            if (this.debugLevel('suicide', creep) > 0) {
                logCreep('☠️', creep.name, reason);
            }
        } else {
            logCreep('⚠️', creep.name, `suicide failed code: ${err}; reason: ${reason}`);
        }
    }

    /** @param {Creep} creep */
    runCreep(creep) {
        if (creep.spawning) return;
        let task = creep.memory.task;
        if (!task) {
            const choice = this.chooseCreepTask(creep) || {
                wander: 'unassigned',
                deadline: Game.time + wanderFor * (0.5 + Math.random()),
                score: 0,
            };
            creep.memory.task = task = {
                assignTime: Game.time,
                ...choice,
            };
        }
        // logCreep('🙋', creep.name, JSON.stringify(task));

        const res = this.execCreepTask(creep, task);
        if (res == null) return;
        if (this.debugLevel('creepTasks', creep) > 0) {
            if (res.ok) {
                logCreep('✅', creep.name, JSON.stringify(task));
            } else if (res.deadline != null) {
                logCreep('⏰', creep.name, res.reason, JSON.stringify(task), `deadline: T${res.deadline}`);
            } else {
                logCreep('🤔', creep.name, res.reason, JSON.stringify(task));
            }
        }
        // TODO collect management data
        delete creep.memory.task;
    }

    /**
     * @param {Creep} creep
     * @returns {Task|null}
     */
    chooseCreepTask(creep) {
        let choices = this.availableCreepTasks(creep);
        choices = debugChoices(this.debugLevel('creepTasks', creep), `TaskFor[${creep.name}]`, bestChoice, choices);
        for (const task of choices) {
            return task;
        }
        return null;
    }

    /**
     * @param {Creep} creep
     * @param {Task} task
     * @returns {{ok: boolean, reason: string, deadline?: number}|null}
     */
    execCreepTask(creep, task) {
        const {deadline} = task;
        if (deadline != null && deadline < Game.time) {
            return {ok: false, reason: 'deadline expired', deadline};
        }

        if (!('wander' in task)) delete creep.memory.wanderingFor;
        if ('do' in task) return this.execCreepAction(creep, task);
        if ('wander' in task) return this.wanderCreep(creep);

        assertNever(task, 'invalid creep task');
    }

    /**
     * @param {Creep} creep
     * @param {DoTask} task
     * @returns {{ok: boolean, reason: string}|null}
     */
    execCreepAction(creep, task) {
        const {code, target} = this.dispatchCreepAction(creep, task);
        switch (code) {

        case ERR_INVALID_TARGET:
            return {ok: false, reason: 'target gone'};

        case ERR_NOT_IN_RANGE:
            if (!target) return {ok: false, reason: 'no target'};
            creep.moveTo(target);
            return null;

        // TODO other forms of pre-error handling
        }

        if (code != OK || !task.repeat) {
            const expected = task.repeat && task.repeat.untilCode;
            const ok = code === OK || code === expected;
            return {ok, reason: `code ${code}`};
        }

        if (task.repeat.untilFull != null &&
            creep.store.getFreeCapacity(task.repeat.untilFull) > 0
        ) return null;

        if (task.repeat.untilEmpty != null &&
            creep.store.getUsedCapacity(task.repeat.untilEmpty) > 0
        ) return null;

        return {ok: true, reason: `code ${code} (final)`};
    }

    /**
     * @param {Creep} creep
     * @param {DoTask} task
     * @returns {{code: ScreepsReturnCode, target?: RoomObject}}
     */
    dispatchCreepAction(creep, task) {
        let target = null;

        switch (task.do) {

        case "harvest":
            target = Game.getObjectById(task.targetId);
            return target ? {
                code: creep.harvest(target),
                target,
            } : {code: ERR_INVALID_TARGET};

        case "build":
            target = Game.getObjectById(task.targetId);
            return target ? {
                code: creep.build(target),
                target,
            } : {code: ERR_INVALID_TARGET};

        case "transfer":
            target = Game.getObjectById(task.targetId);
            return target ? {
                code: creep.transfer(target, task.resourceType, task.amount),
                target,
            } : {code: ERR_INVALID_TARGET};

        case "upgradeController":
            target = Game.getObjectById(task.targetId);
            return target ? {
                code: creep.upgradeController(target),
                target,
            } : {code: ERR_INVALID_TARGET};

        case "pickup":
            target = Game.getObjectById(task.targetId);
            return target ? {
                code: creep.pickup(target),
                target,
            } : {code: ERR_INVALID_TARGET};

        default:
            assertNever(task, 'invalid creep action');
        }
    }

    /** @param {Creep} creep */
    wanderCreep(creep) {
        // NOTE update docs on WanderTask with semantics
        const wanderingFor = (creep.memory.wanderingFor || 0) + 1;
        creep.memory.wanderingFor = wanderingFor;
        if (wanderingFor >= 3*wanderFor) {
            // TODO not past minRoomCreeps
            this.disposeCreep(creep, `wandered for ${wanderingFor} ticks`);
            return null;
        }

        const dir = moveDirections[Math.floor(Math.random() * moveDirections.length)];
        const err = creep.move(dir);
        if (err === OK) return null; // keep going until deadline
        if (err === ERR_NO_BODYPART) {
            this.killCreep(creep, 'unable to move');
            return null; // leave task on zombie
        }
        return {ok: false, reason: `code: ${err}`};
    }

    /**
     * @param {Creep} creep
     * @returns {Generator<Task>}
     */
    *availableCreepTasks(creep) {
        const contribMin = 0.05;
        const contribMax = 0.25;
        /**
         * @param {number} have
         * @param {number} progress
         * @param {number} total
         */
        function scoreContrib(have, progress, total) {
            const remain = total - progress;
            const contribP = have / remain;
            return normalScore(contribP, contribMin, contribMax);
        }

        const haveEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (haveEnergy) {
            for (const struct of this.find(creep.room, FIND_MY_STRUCTURES)) {
                switch (struct.structureType) {
                    case STRUCTURE_SPAWN:
                    case STRUCTURE_EXTENSION:
                        const cap = struct.store.getFreeCapacity(RESOURCE_ENERGY);
                        if (cap <= 0) continue;
                        const capScore = Math.min(1, cap / haveEnergy);
                        const distScore = distanceScore(creep.pos, struct.pos);
                        yield {
                            do: 'transfer',
                            targetId: struct.id,
                            resourceType: RESOURCE_ENERGY,
                            repeat: {
                                untilEmpty: RESOURCE_ENERGY,
                                untilCode: ERR_NOT_ENOUGH_RESOURCES,
                            },
                            score: capScore * distScore,
                        };
                        break;
                    // TODO other structure types? priority by type?
                }
            }

            const ctl = creep.room.controller;
            if (ctl && ctl.my && !ctl.upgradeBlocked) {
                const contribScore = scoreContrib(haveEnergy, ctl.progress, ctl.progressTotal);
                const iqScore = inverseQuadScore(ctl.ticksToDowngrade, creep.pos, ctl.pos);
                yield {
                    do: 'upgradeController',
                    targetId: ctl.id,
                    repeat: {
                        untilEmpty: RESOURCE_ENERGY,
                        untilCode: ERR_NOT_ENOUGH_RESOURCES,
                    },
                    score: Math.max(contribScore, iqScore),
                };
            }
        }

        const canCarry = creep.getActiveBodyparts(CARRY) > 0;
        if (canCarry) {
            const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES);
            if (dropped &&
                creep.store.getFreeCapacity(dropped.resourceType) > dropped.amount
            ) yield {
                do: 'pickup',
                targetId: dropped.id,
                score: 0.5, // TODO take distance / decay into account
            };
            // TODO transfer from tombstones
            // TODO it's always an option to put things in storage or to drop them
        }

        const canWork = creep.getActiveBodyparts(WORK) > 0;
        if (canWork) {
            if (haveEnergy) {
                for (const site of this.find(creep.room, FIND_CONSTRUCTION_SITES)) {
                    const contribScore = scoreContrib(haveEnergy, site.progress, site.progressTotal);
                    yield {
                        do: 'build',
                        targetId: site.id,
                        repeat: {
                            untilEmpty: RESOURCE_ENERGY,
                            untilCode: ERR_NOT_ENOUGH_RESOURCES,
                        },
                        score: contribScore, // TODO penalize distance?
                    };
                }
            }

            if (canCarry && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                // TODO rank all sources
                const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) yield {
                    do: 'harvest',
                    targetId: source.id,
                    repeat: {untilFull: RESOURCE_ENERGY},
                    score: 0.4, // TODO factor in availability
                };
            }

            // TODO harvest minerals
            // TODO other worker tasks like repair
        }

        // TODO other modalities like heal and attack
    }

    /** @type {null|Object<string, number>} */
    debugLevelCache = null;

    /**
     * @param {string} what
     * @param {Room|Creep|StructureSpawn|Flag|PowerCreep} [subject]
     */
    debugLevel(what, subject) {
        if (!this.debugLevelCache) return debugLevel(what, subject);
        const cacheKey = `${objectKey(subject)}.${what}`;
        if (cacheKey in this.debugLevelCache)
            return this.debugLevelCache[cacheKey];
        return this.debugLevelCache[cacheKey] = debugLevel(what, subject);
    }

    /** @type {null|Object<string, Object<string, any>>} */
    findCache = null;

    /**
     * @template {FindConstant} K
     * @param {Room} room
     * @param {K} type
     * @returns {Generator<FindTypes[K]>}
     */
    *find(room, type) {
        let roomCache = this.findCache && this.findCache[room.name];
        const cached = roomCache && roomCache[type];
        if (cached) {
            yield* cached
            return;
        }

        const res = room.find(type);
        if (this.findCache) {
            if (!roomCache) {
                roomCache = {};
                this.findCache[room.name] = roomCache;
            }
            roomCache[type] = res;
        }
        yield* res;
    }
}

/**
 * @param {number|undefined} a
 * @param {number|undefined} b
 * @returns {number}
 */
function nanMin(a, b) {
    if (typeof a != 'number' || isNaN(a))
        return typeof b == 'number' ? b : NaN;
    if (typeof b != 'number' || isNaN(b))
        return typeof a == 'number' ? a : NaN;
    return Math.min(a, b);
}

// TODO targeting older JS used by screeps, would be nice to use things like
// existential operator and Object.fromEntries someday

/** @param {[string, any][]} entries */
function fromEntries(entries) {
    /** @type {Object<string, any>} */
    const obj = {};
    for (const [prop, val] of entries) {
        obj[prop] = val;
    }
    return obj;
}

/**
 * @param {undefined|null|Room|Creep|StructureSpawn|Flag|PowerCreep} object
 * @returns {string}
 */
function objectKey(object) {
    if (object instanceof Room) return `Room_${object.name}`;
    if (object instanceof Creep) return `Creep_${object.name}`;
    if (object instanceof StructureSpawn) return `Spawn_${object.name}`;
    if (object instanceof Flag) return `Flag_${object.name}`;
    if (object instanceof PowerCreep) return `PowerCreep_${object.name}`;
    return '';
}

/**
 * @param {string} what
 * @param {Room|Creep|StructureSpawn|Flag|PowerCreep} [subject]
 */
function debugLevel(what, subject) {
    let level = 0;
    for (const debug of [
        subject && 'memory' in subject && subject.memory.debug,
        subject && 'room' in subject && subject.room && subject.room.memory.debug,
        Memory.debug,
    ]) if (debug) switch (typeof debug) {
        case 'number':
            level = Math.max(level, debug);
            break;
        case 'object':
            if (what in debug) return debug[what];
            break;
    }
    return level;
}

class CreepDesign {
    /** @typedef {[ResourceConstant, number][]} costEntries */

    /**
    * @param {Object<ResourceConstant, number>} resources
    * @param {Object} [opts]
    * @param {ResourceConstant} [opts.defaultResource]
    * @param {(part: BodyPartConstant) => costEntries} [opts.costs]
    * @param {Object<string, any>} [opts.env]
    */
    constructor(resources, opts={}) {
        const {
            defaultResource = /** @type {ResourceConstant[]} */ (Object.keys(resources))[0],
            costs = part => defaultResource ? [[defaultResource, BODYPART_COST[part]]] : [],
            env = {},
        } = opts;
        this.env = env;
        this.resources = resources;
        this.costs = costs;
        /** @type {BodyPartConstant[]} */
        this.parts = [];
        /** @type {Object<ResourceConstant, number>} */
        this.spent = {};
        /** @type {[string, any][]} */
        this.entries = [];
    }

    get result() {
        return {
            name: 'Untitled',
            ...fromEntries(this.entries),
            parts: this.parts.reverse(),
            resources: this.spent,
        };
    }

    /** @param {costEntries} costs */
    spend(...costs) {
        for (const [resource, amount] of costs) {
            const have = this.resources[resource];
            if (typeof have != 'number' || isNaN(have) || have < amount) return false;
        }
        for (const [resource, amount] of costs) {
            this.resources[resource] -= amount;
            this.spent[resource] = (this.spent[resource] || 0) + amount;
        }
        return true;
    }

    /**
     * @param {BodyPartConstant} part
     * @param {number} [n]
     */
    produce(part, n=1) {
        for (let i = 0; i < n; ++i) {
            if (this.spend(...this.costs(part))) {
                this.parts.push(part);
            } else {
                return i;
            }
        }
        return n;
    }
}

if (Memory.notes == null) Memory.notes = {};

/**
 * @param {Iterable<string>} tokens
 * @Generator<T|number>
 */
function* uniq(tokens) {
    let last = '', n = 0;
    for (const token of tokens) {
        if (token !== last) {
            if (n > 1) yield n;
            yield last = token;
            n = 1;
        } else n++;
    }
    if (n > 1) yield n;
}

/** @param {string} id */
function note(id) {
    if (Memory.notes[id] != null) return false;
    Memory.notes[id] = Game.time;
    return true;
}

/**
 * @param {string} mark
 * @param {string} name
 * @param {any[]} mess
 */
function logRoom(mark, name, ...mess) { log(mark, 'Rooms', name, ...mess); }

/**
 * @param {string} mark
 * @param {string} name
 * @param {any[]} mess
 */
function logSpawn(mark, name, ...mess) { log(mark, 'Spawns', name, ...mess); }

/**
 * @param {string} mark
 * @param {string} name
 * @param {any[]} mess
 */
function logFlag(mark, name, ...mess) { log(mark, 'Flags', name, ...mess); }

/**
 * @param {string} mark
 * @param {string} name
 * @param {any[]} mess
 */
function logPowerCreep(mark, name, ...mess) { log(mark, 'PowerCreeps', name, ...mess); }

/**
 * @param {string} mark
 * @param {string} name
 * @param {any[]} mess
 */
function logCreep(mark, name, ...mess) { log(mark, 'Creeps', name, ...mess); }

/**
 * @param {string} mark
 * @param {string} kind
 * @param {string} name
 * @param {any[]} mess
 */
function log(mark, kind, name, ...mess) {
    // TODO collect entry alongside tick events?
    console.log(`T${Game.time} ${mark} ${kind}.${name}`, ...mess);
}

/**
 * @param {number} measure
 * @param {number} min
 * @param {number} max
 */
function normalScore(measure, min, max) {
    const p = (measure - min) / (max - min);
    return Math.max(0, Math.min(1, p));
}

/**
 * @param {Point} a
 * @param {Point} b
 */
function distanceScore(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const quad = dx * dx + dy * dy;
    const raw = quad / ROOM_QUAD;
    return Math.max(0, Math.min(1, 1 - raw));
}

/**
 * @param {number} measure
 * @param {Point} a
 * @param {Point} b
 */
function inverseQuadScore(measure, a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const quad = dx * dx + dy * dy;
    if (measure > quad) return 0;
    return 1 - normalScore(measure, Math.sqrt(quad), quad);
}

/**
 * @template {(Object & {score?: number})} T
 * @param {Iterable<T>} choices
 * @returns {Generator<T>}
 */
function *bestChoice(choices) {
    // TODO heap select top N
    let best = null;
    for (const choice of choices) {
        const score = choice.score || 0;
        const prior = best && best.score;
        if (typeof prior != 'number' || score > prior || isNaN(prior)) {
            best = choice;
        }
    }
    if (best) yield best;
}

/**
 * @template T
 * @param {number} level
 * @param {string} name
 * @param {(choices: Iterable<T>) => Iterable<T>} chooser
 * @param {Iterable<T>} choices
 * @returns {Generator<T>}
 */
function* debugChoices(level, name, chooser, choices) {
    if (level > 1) choices = logChoices(`... choice ${name}`, choices);
    choices = chooser(choices);
    if (level > 0) choices = logChoices(`>>> choose ${name}`, choices);
    yield* choices;
}

/**
 * @template T
 * @param {string} label
 * @param {Iterable<T>} choices
 * @returns {Generator<T>}
 */
function* logChoices(label, choices) {
    for (const choice of choices) {
        console.log(`${label} ${JSON.stringify(choice)}`);
        yield choice;
    }
}

/**
 * @param {never} _
 * @param {string} [mess]
 * @returns {never}
 */
function assertNever(_, mess='inconceivable') {
    throw new Error(mess);
}

module.exports = new Agent();
