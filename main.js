const wanderFor = 10;

module.exports = {
    loop() {
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
            if (!Game.creeps[name])
                this.forgetCreep(name, mem);
        }
        // TODO forget spawns
        // TODO forget rooms?
        // forget notes once their object is gone
        for (const id of Object.keys(Memory.notes)) {
            if (!Game.getObjectById(id))
                delete Memory.notes[id];
        }
    },

    spawnCreepsIn(room) {
        const spawns = room.find(FIND_MY_SPAWNS).filter(spawn => !spawn.spawning);
        if (!spawns.length) continue;
        const spawn = spawns[0]; // TODO better selection
        const creeps = room.find(FIND_MY_CREEPS);
        if (room.energyAvailable < 300 ||
            (creeps.length < 2 && room.energyAvailable < room.energyCapacityAvailable
        )) continue;
        const partCost = 100;
        const maxParts = Math.floor(room.energyAvailable / partCost);
        // TODO specialization / design
        const parts = [WORK, CARRY, MOVE];
        for (let i=0, more=[MOVE, WORK, MOVE, CARRY]; parts.length < maxParts; i++)
            parts.unshift(more[i % more.length]);
        const newName = 'Worker' + Game.time;
        const res = spawn.spawnCreep(parts, newName);
        if (res == OK) logSpawn('⨁', spawn.name, parts, newName);
        else logSpawn('⚠️', spawn.name, parts, newName, res);
    },

    reapCreepsIn(room) {
        for (const {id, creep, deathTime} of room.find(FIND_TOMBSTONES)) {
            if (!creep.my) continue;
            if (note(id)) {
                this.reapCreep(creep, deathTime);
                // TODO post a room job to collect any storage within ticksToDecay
            }
        }
    },

    runCreep(creep) {
        if (creep.spawning) return;
        let task = creep.memory.task;
        if (!task) return;
        if (!task) task = this.assignCreep(creep);
        creep.memory.task = task;
        // logCreep('🙋', creep.name, JSON.stringify(task));
        const res = this.runCreepTask(creep, task);
        if (res == null) return;
        if (!res.ok) {
            if (res.deadline != null) {
                logCreep('⏰', creep.name, res.reason, JSON.stringify(task), `deadline: T${res.deadline}`);
            } else {
                logCreep('🤔', creep.name, res.reason, JSON.stringify(task));
            }
        }
        // TODO collect management data
        delete creep.memory.task;
    },

    runCreepTask(creep, task) {
        const {deadline} = task;
        if (deadline != null && deadline < Game.time) {
            return {ok: false, reason: 'deadline expired', deadline};
        }

        if (!task.wander) delete creep.memory.wanderingFor;
        if (task.do) return this.doCreepTask(creep, task);
        if (task.wander) return this.wanderCreep(creep);

        return {ok: false, reason: 'invalid creep task'};
    },

    doCreepTask(creep, task) {
        const fun = creep[task.do];
        if (typeof fun != 'function') {
            return {ok: false, reason: 'invalid creep function'};
        }

        const target = Game.getObjectById(task.targetId);
        if (!target) {
            return {ok: false, reason: 'target gone'};
        }

        let err = fun.call(creep, target, ...(task.extra || []));
        // TODO other forms of pre-error handling
        if (err == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
            return null;
        }

        if (err != OK || !task.repeat) {
            const expected = task.repeat && task.repeat.untilErr;
            const ok = err === OK || err === expected;
            return {ok, reason: `code ${err}`};
        }

        if (task.repeat.untilFull != null &&
            creep.store.getFreeCapacity(task.repeat.untilFull) > 0
        ) return null;

        if (task.repeat.untilEmpty != null &&
            creep.store.getUsedCapacity(task.repeat.untilEmpty) > 0
        ) return null;

        return {ok: true, reason: `code ${err} (final)`};
    },

    wanderCreep(creep) {
        const wanderingFor = (creep.memory.wanderingFor || 0) + 1;
        creep.memory.wanderingFor = wanderingFor;
        if (wanderingFor >= 2*wanderFor) {
            this.disposeCreep(creep, `wandered for ${wanderingFor} ticks`);
            return null;
        }

        const directions = [
            TOP,
            TOP_RIGHT,
            RIGHT,
            BOTTOM_RIGHT,
            BOTTOM,
            BOTTOM_LEFT,
            LEFT,
            TOP_LEFT,
        ];
        const err = creep.move(directions[Math.floor(Math.random() * directions.length)]);
        if (err === OK) return null; // keep going until deadline
        if (err === ERR_NO_BODYPART) {
            this.killCreep(creep, 'unable to move');
            return null; // leave task on zombie
        }
        return {ok: false, reason: `code: ${err}`};
    },

    reapCreep(creep, deathTime) {
        // TODO use deathTime to explain death from room.getEventLog collection
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
    },

    forgetCreep(name, mem=Memory.creeps[name]) {
        delete Memory.creeps[name];
        logCreep('👻', name, JSON.stringify(mem));
    },

    assignCreep(creep) {
        for (const choice of bestChoice(this.availableCreepTasks(creep))) {
            return {assignTime: Game.time, ...choice};
        }
        const forTicks = wanderFor * (0.5 + Math.random());
        return {
            assignTime: Game.time,
            wander: true,
            deadline: Game.time + forTicks,
        };
    },

    *availableCreepTasks(creep) {
        const contribMin = 0.05;
        const contribMax = 0.25;
        function scoreContrib(have, progress, total) {
            const remain = total - progress;
            const contribP = have / remain;
            return normalScore(contribP, contribMin, contribMax);
        }

        const haveEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (haveEnergy) {
            // TODO spawns
            // TODO extensions
            const ctl = creep.room.controller;
            if (ctl && ctl.my && !ctl.upgradeBlocked) {
                const contribScore = scoreContrib(haveEnergy, ctl.progress, ctl.progressTotal);
                const iqScore = inverseQuadScore(ctl.ticksToDowngrade, creep.pos, ctl.pos);
                yield {
                    score: Math.max(contribScore, iqScore),
                    do: 'upgradeController',
                    targetId: ctl.id,
                    repeat: {
                        untilEmpty: RESOURCE_ENERGY,
                        untilErr: ERR_NOT_ENOUGH_RESOURCES,
                    },
                };
            }
        }

        const canCarry = creep.getActiveBodyparts(CARRY) > 0;
        if (canCarry) {
            const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES);
            if (dropped &&
                creep.store.getFreeCapacity(dropped.resourceType) > dropped.amount
            ) yield {
                score: 0.5, // TODO take distance / decay into account
                do: 'pickup',
                targetId: dropped.id,
            };
            // TODO transfer from tombstones
            // TODO it's always an option to put things in storage or to drop them
        }

        const canWork = creep.getActiveBodyparts(WORK) > 0;
        if (canWork) {
            if (haveEnergy) {
                for (const site of creep.room.find(FIND_CONSTRUCTION_SITES)) yield {
                    score: scoreContrib(haveEnergy, site.progress, site.progressTotal), // TODO penalize distance?
                    do: 'build',
                    targetId: site.id,
                    repeat: {
                        untilEmpty: RESOURCE_ENERGY,
                        untilErr: ERR_NOT_ENOUGH_RESOURCES,
                    },
                };
            }

            if (canCarry && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                // TODO rank all sources
                const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) yield {
                    score: 0.4, // TODO factor in availability
                    do: 'harvest',
                    targetId: source.id,
                    repeat: {untilFull: RESOURCE_ENERGY},
                };
            }

            // TODO harvest minerals
            // TODO other worker tasks like repair
        }

        // TODO other modalities like heal and attack
    },

    disposeCreep(creep, reason) {
        // TODO task to recycle at nearest spawn
        this.killCreep(creep, reason);
    },

    killCreep(creep, reason) {
        const err = creep.suicide();
        if (err === OK) {
            logCreep('☠️', creep.name, reason);
        } else {
            logCreep('⚠️', creep.name, `suicide failed code: ${err}; reason: ${reason}`);
        }
    },

};

if (Memory.notes == null) Memory.notes = {};

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

function note(id) {
    if (Memory.notes[id] != null) return false;
    Memory.notes[id] = Game.time;
    return true;
}

function logSpawn(mark, name, ...mess) { log(mark, 'Spawns', name, ...mess); }
function logCreep(mark, name, ...mess) { log(mark, 'Creeps', name, ...mess); }

function log(mark, kind, name, ...mess) {
    // TODO collect entry alongside tick events?
    console.log(`T${Game.time} ${mark} ${kind}.${name}`, ...mess);
}

function normalScore(measure, min, max) {
    const p = (measure - min) / (max - min);
    return Math.max(0, Math.min(1, p));
}

function inverseQuadScore(measure, a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const quad = dx * dx + dy * dy;
    if (measure > quad) return 0;
    return 1 - normalScore(measure, Math.sqrt(quad), quad);
}

function *bestChoice(choices) {
    // TODO heap select top N
    let best = null;
    for (const choice of choices) {
        const score = choice.score || 0;
        const prior = best && best.score;
        if (score > prior || typeof prior != 'number' || isNaN(prior)) {
            best = choice;
        }
    }
    if (best) yield best;
}
