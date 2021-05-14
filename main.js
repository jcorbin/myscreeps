module.exports = {
    loop() {
        for (const room of Object.values(Game.rooms)) {
            // TODO reap
            this.spawnCreepsIn(room);
        }

        for (const creep of Object.values(Game.creeps)) {
            this.runCreep(creep);
        }

        // TODO forget
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

    manageCreep(creep) {
        if (creep.getActiveBodyparts(CARRY) > 0) {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
                return {
                    do: 'upgradeController',
                    targetId: creep.room.controller.id,
                    repeat: {
                        untilEmpty: RESOURCE_ENERGY,
                        untilErr: ERR_NOT_ENOUGH_RESOURCES,
                    },
                };
            }

            // TODO other resources
        }

        // TODO if we have full store, what to do

        const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES);
        if (dropped &&
            creep.store.getFreeCapacity(dropped.resourceType) > dropped.amount
        ) return {do: 'pickup', targetId: dropped.id};

        if (creep.getActiveBodyparts(WORK) > 0) {
            if (creep.getActiveBodyparts(CARRY) > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) == 0) return null; // TODO above should prevent this
            const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
            if (source) return {
                do: 'harvest',
                targetId: source.id,
                repeat: {untilFull: RESOURCE_ENERGY},
            };
        }
    },

    runCreep(creep) {
        if (creep.spawning) return;
        let job = creep.memory.job;
        if (!job) job = this.manageCreep(creep);
        if (!job) return;
        creep.memory.job = job;
        // logCreep('🙋', creep.name, JSON.stringify(job));
        const res = this.runCreepJob(creep, job);
        if (res == null) return;
        if (!res.ok) {
            logCreep('🤔', creep.name, res.reason, JSON.stringify(job));
        }
        // TODO collect management data
        delete creep.memory.job;
    },

    runCreepJob(creep, job) {
        if (job.do) return this.doCreepJob(creep, job);

        return {ok: false, reason: 'invalid creep job'};
    },

    doCreepJob(creep, job) {
        const fun = creep[job.do];
        if (typeof fun != 'function') {
            return {ok: false, reason: 'invalid creep function'};
        }

        const target = Game.getObjectById(job.targetId);
        if (!target) {
            return {ok: false, reason: 'target gone'};
        }

        let err = fun.call(creep, target, ...(job.extra || []));
        // TODO other forms of pre-error handling
        if (err == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
            return null;
        }

        if (err != OK || !job.repeat) {
            const expected = job.repeat && job.repeat.untilErr;
            const ok = err === OK || err === expected;
            return {ok, reason: `code ${err}`};
        }

        if (job.repeat.untilFull != null &&
            creep.store.getFreeCapacity(job.repeat.untilFull) > 0
        ) return null;

        if (job.repeat.untilEmpty != null &&
            creep.store.getUsedCapacity(job.repeat.untilEmpty) > 0
        ) return null;

        return {ok: true, reason: `code ${err} (final)`};
    },

};

function logSpawn(mark, name, ...mess) { log(mark, 'Spawns', name, ...mess); }
function logCreep(mark, name, ...mess) { log(mark, 'Creeps', name, ...mess); }

function log(mark, kind, name, ...mess) {
    // TODO collect entry alongside tick events?
    console.log(`T${Game.time} ${mark} ${kind}.${name}`, ...mess);
}
