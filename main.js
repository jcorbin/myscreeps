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
        if (res == OK) console.log('spawning', spawn.name, newName, parts);
        else console.log('cannot spawn', spawn.name, parts, res);
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

        if (!creep.memory.job) {
            const job = this.manageCreep(creep);
            if (!job) return;
            creep.memory.job = job;
            // console.log('🙋', creep.name, JSON.stringify(job));
        }
        
        const job = creep.memory.job;
        if (job.do) {
            const fun = creep[job.do];
            const target = Game.getObjectById(job.targetId);
            if (!target) {
                job.res = ERR_INVALID_TARGET;
            } else if (typeof fun == 'function') {
                let res = fun.call(creep, target, ...(job.extra || []));
                if (res == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);
                    return;
                } else if (job.repeat) {
                    if (res == OK) {
                        if (job.repeat.untilFull != null &&
                            creep.store.getFreeCapacity(job.repeat.untilFull) > 0
                        ) return;
                        if (job.repeat.untilEmpty != null &&
                            creep.store.getUsedCapacity(job.repeat.untilEmpty) > 0
                        ) return;
                    } else if (res == job.repeat.untilErr) res = OK;
                }
                job.res = res;
            }
        }
        
        if (job.res != OK) console.log('🤔', creep.name, JSON.stringify(job));
        delete creep.memory.job;
    },
}
