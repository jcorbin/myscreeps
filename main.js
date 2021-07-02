// @ts-check

// TODO better if we can get room size from platform
const ROOM_WIDTH = 50;
const ROOM_HEIGHT = 50;
const ROOM_QUAD = ROOM_WIDTH * ROOM_HEIGHT;
const ROOM_DIAG = Math.sqrt(ROOM_QUAD);

const defaultMoveRate = 0.1;
const minRoomCreeps = 2;
const minSpawnProgressP = 0.1;

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

            // populate initial room jobs, or update on deadline; leave regular
            // updates to be demanded by seeking creeps
            this.updateRoomJobs(room, NaN);
        }

        let creeps = Object.values(Game.creeps);
        while (creeps.length) creeps = creeps.filter(creep => this.runCreepTask(creep));

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
     * @returns {boolean}
     */
    runCreepTask(creep) {
        const {name, memory, spawning} = creep;
        if (spawning) return false;
        const debugLevel = this.debugLevel('creepTasks', creep);

        const oldJobNames = new Set(memory.task && taskJobNames(memory.task));
        const res = this.execCreepTask(creep, memory.task || (() => this.initCreepTask(creep)));

        // task yields
        if (!res) {
            return false;
        }

        // task continues...
        const {nextTask} = res;
        if (nextTask) {
            memory.task = nextTask;
            const newJobNames = new Set(taskJobNames(nextTask));
            this.updateAssignedJobs(creep, oldJobNames, newJobNames);
            if (debugLevel > 0) logCreep('⏭', name, JSON.stringify(nextTask));
            return true;
        }


        // task done
        this.reviewCreepTask(creep, res); // final review

        this.updateAssignedJobs(creep, oldJobNames, new Set());
        if (memory.task) {
            delete memory.task;
        }
        return true;
    }


    /**
     * @param {Creep} creep
     * @param {Taskable} task
     * @returns {TaskResult|null}
     */
    execCreepTask(creep, task) {
        // TODO eliminate this wrapper
        return this.execCreepTaskable(creep, task) || null;
    }

    /**
     * @param {Creep} creep
     * @param {Taskable} task
     * @returns {TaskResult|null|undefined}
     */
    execCreepTaskable(creep, task) {
        if (typeof task == 'function') return task();

        if ('do' in task)
            return this.execCreepAction(creep, task);
        if ('think' in task)
            return this.execCreepThought(creep, task);

        if ('time' in task) {
            const exec = Game.time;
            /** @type {TaskResult|null} */
            let yld = null;
            if (typeof task.time == 'number') {
                const init = task.time;
                task.time = {init, cont: init, exec};
                yld = {ok: true, reason: 'time init', nextTask: task};
            }

            const {ok: under, fail} = unpackTaskThen(task.then);
            if (!under) return yld;

            task.time.exec = exec;
            const subRes = this.execCreepSubtask(creep, task, under);
            if (!subRes) return yld;

            const {subTask, res} = subRes;
            if (subTask) {
                task.time.cont = exec;
                task.then = makeTaskThen(subTask, fail);
            }
            return resolveThen(fail && {fail}, res);
        }

        if ('timeout' in task) {
            const {timeout, ...rest} = task;
            const deadline = Game.time + timeout;
            task = {deadline, ...rest};
        }

        // TODO may need ability for a continue result to cancel a deadline...
        // maybe timeout/deadline is just "one-shot" then?

        if ('deadline' in task) {
            const {deadline, then} = task;
            const {ok: under, fail} = unpackTaskThen(then);
            if (deadline < Game.time) return {
                ok: false, reason: 'deadline expired', deadline,
                nextTask: fail,
            };
            const subRes = under && this.execCreepSubtask(creep, task, under);
            if (!subRes) return null;
            const {subTask, res} = subRes;
            if (subTask) task.then = makeTaskThen(subTask, fail);
            return res;
        }

        if ('sleep' in task) {
            if (typeof task.sleep == 'number') task.sleep = {until: Game.time + task.sleep};
            else if ('ticks' in task.sleep) task.sleep = {until: Game.time + task.sleep.ticks};
            return Game.time < task.sleep.until ? null : {ok: true, reason: 'woke'};
        }

        if ('while' in task) return this.execCreepLoopTask(creep, task, task.while, null);
        if ('until' in task) return this.execCreepLoopTask(creep, task, {not: task.until}, null);
        if ('doWhile' in task) return this.execCreepLoopTask(creep, task, null, task.doWhile);
        if ('doUntil' in task) return this.execCreepLoopTask(creep, task, null, {not: task.doUntil});

        assertNever(task, 'invalid creep task');
    }

    /**
     * @param {Creep} creep
     * @param {LoopTask} loop
     * @param {LoopPredicate|null} predicate
     * @param {LoopDoPredicate|null} doPredicate
     * @returns {TaskResult|null}
     */
    execCreepLoopTask(creep, loop, predicate, doPredicate) {
        return this.execCreepTaskLoop(creep, loop, body => {
            // TODO break if not predicate()

            // TODO bodyRes = body()

            // // start a run of the body task if predicate is (still) ok:true or
            // return predRes.ok
            //     ? this.execCreepTaskable(creep, body)
            //     : undefined;

            // TODO break if !doPredicate(bodyRes)

            // const predRes = this.execCreepTaskSub(creep, task, 'pred', predicate);
            // if (predRes === undefined) return {ok: false, reason: 'unable to execute predicate'};
            // if (!predRes || predRes.nextTask) return predRes; // predicate yields or continues

        });
    }

    /**
     * @param {Creep} creep
     * @param {Task & TaskSub} task
     * @param {(body: Task) => TaskResult|null|undefined} body
     * @returns {TaskResult|null}
     */
    execCreepTaskLoop(creep, task, body) {
        const res = this.execCreepTaskSub(creep, task,
            'body', () => body(taskThenOk(task) || {sleep: 1}));
        return res === undefined // loop done (predicate falsified)
            ? {ok: true, reason: 'loop done', nextTask: taskThenFail(task)} // continue to then.fail or return a terminal result
            : res; // loop continues or yields
    }

    // TODO for creep clauses
    // if (code != OK || !task.repeat) {
    //     const expected = task.repeat && task.repeat.untilCode;
    //     const ok = code === OK || code === expected;
    //     return resolveTaskThen(task, {ok, reason: `code ${code}`});
    // }
    // if (task.repeat.untilFull != null &&
    //     creep.store.getFreeCapacity(task.repeat.untilFull) > 0
    // ) return null;
    // if (task.repeat.untilEmpty != null &&
    //     creep.store.getUsedCapacity(task.repeat.untilEmpty) > 0
    // ) return null;
    // if (task.repeat.whileCode != null &&
    //     code === task.repeat.whileCode
    // ) return null;

    /**
     * @param {Creep} creep
     * @param {Task} task
     * @param {Taskable} subTask
     * @returns {{subTask: Task, res: null}|{subTask: Task|null, res: TaskResult}|null|undefined}
     */
    execCreepSubtask(creep, task, subTask) {
        const subRes = this.execCreepTaskable(creep, subTask);
        if (!subRes) {
            if (typeof subTask == 'function') return subRes; // subtask init yielded
            return {subTask, res: null};
        }
        const {nextTask: nextSubTask, ...subFin} = subRes;
        return nextSubTask
            ? {subTask: nextSubTask, res: {nextTask: task, ...subFin}}
            : {subTask: null, res: subFin};
    }

    /**
     * @param {Creep} creep
     * @param {Task & TaskSub} task
     * @param {string} name
     * @param {Taskable} [init]
     * @returns {TaskResult|null|undefined}
     */
    execCreepTaskSub(creep, task, name, init) {
        const sub = task.sub && task.sub[name] || init;
        if (!sub) return undefined;
        const subRes = this.execCreepSubtask(creep, task, sub);
        if (!subRes) return subRes;
        const {subTask, res} = subRes;
        if (subTask) {
            if (!task.sub) task.sub = {};
            task.sub[name] = subTask;
        } else if (task.sub) {
            delete task.sub[name];
            if (!Object.keys(task.sub).length) delete task.sub;
        }
        return res;
    }

    /**
     * @param {Creep} creep
     * @param {Task|null} [argTask]
     * @param {MentalTask} task
     * @returns {TaskResult|null}
     */
    execCreepThought(creep, task) {
        switch (task.think) {

            case 'review':
                return this.reviewCreepTask(creep, task);

            case 'seek':
                return this.seekCreepTask(creep, task);

            case 'haveResource':
                return this.execCreepTaskLoop(creep, task, () => {
                    if (hasActed(creep)) return null; // store data may be invalid
                    const {resourceType, min} = task;
                    if (creep.store.getUsedCapacity(resourceType) < min)
                        return {ok: true, reason:`insufficient resourceType:${resourceType}`};
                    return {ok: false, reason: `sufficient resourceType:${resourceType}`};
                });

            case 'freeCapacity':
                return this.execCreepTaskLoop(creep, task, () => {
                    if (hasActed(creep)) return null; // store data may be invalid
                    const {resourceType, min} = task;
                    if (creep.store.getFreeCapacity(resourceType) < min)
                        return {ok: true, reason: `insufficient resourceType:${resourceType} capacity`};
                    return {ok: false, reason: `sufficient resourceType:${resourceType} capacity`};
                });

            default:
                assertNever(task, 'invalid creep thought');
        }
    }

    /**
     * @param {Creep} _creep
     * @returns {TaskResult|null}
     */
    initCreepTask(_creep) {
        return {
            ok: true,
            reason: 'creep task init',
            nextTask: {
                time: Game.time,
                then: {
                    think: 'seek',
                    then: {fail: {
                        timeout: 30,
                        then: {do: 'wander', reason: 'idle'},
                    }},
                },
            },
            // TODO then: {fail: {dispose: 'wandered too long'}},
            // TODO failed wander leads to suicide
            // ; should this just be same dispose as wander deadline?
            // ; would need to add `code?: ScreepsReturnCode` to TaskResult
            // if (code === ERR_NO_BODYPART) {
            //     this.killCreep(creep, 'unable to move');
            //     return null; // leave task on zombie
            // }
        };
    }

    /**
     * @param {Creep} creep
     * @param {Task} [task]
     * @returns {TaskResult}
     */
    planCreepTask(creep, task) {
        if (!task) return {ok: false, reason: 'untasked'};

        let planTask = task;

        const {jobName} = task;
        const job = jobName && ifirst(lookupJob(jobName, creep));
        if (jobName && job) {
            const {
                requirements: {
                    resources,
                    capacity,
                } = {},
            } = job;
            const defaultReqLoad = creep.getActiveBodyparts(CARRY) * CARRY_CAPACITY;

            // plan to free up needed capacity
            for (const [resourceType, min] of reqSpecEntries(capacity, defaultReqLoad)) if (resourceType)
                planTask = {
                    jobName,
                    think: 'freeCapacity', resourceType, min, then: {
                        fail: {jobName, think: 'seek', must: true, capacity: resourceType, min, then: planTask},
                        // TODO loop back to freeCapacity for multi-step
                        ok: planTask,
                    },
                };

            // plan to seek and acquire needed resources
            for (const [resourceType, min] of reqSpecEntries(resources, defaultReqLoad)) if (resourceType)
                planTask = {
                    jobName,
                    think: 'haveResource', resourceType, min, then: {
                        fail: {jobName, think: 'seek', must: true, acquire: resourceType, then: planTask},
                        // TODO loop back to haveResource for multi-step
                        ok: planTask,
                    },
                };
        }

        return {ok: true, reason: 'then the murders began', nextTask: planTask};
    }

    /**
     * @param {Creep} creep
     * @param {ReviewTask} [review]
     * @param {ReviewTask} review
     * @returns {TaskResult|null}
     */
    reviewCreepTask(creep, review) {
        const {name, memory} = creep;
        const debugLevel = this.debugLevel('creepTasks', creep);
        const {task} = memory;
        if (!task) return resolveTaskThen(review, {ok: false, reason: 'cannot review unassigned creep'});
        const result = review && argResult(review.arg);
        const mark =
            result && !result.ok ?  '⛔️'
            : debugLevel > 0
            ? (!result ? '🤔' : '✅')
            : '';
        if (mark) logCreep(mark, name, JSON.stringify({result, task}));
        // TODO collect metrics
        return resolveTaskThen(review, {ok: true, reason: 'reviewed'});
    }

    /**
     * @param {Creep} creep
     * @param {SeekTask} seek
     * @returns {TaskResult|null}
     */
    seekCreepTask(creep, seek) {
        const debugLevel = this.debugLevel('creepTasks', creep);

        let choices = this.availableCreepTasks(creep);

        /** @type {Task|null} */
        let fallback = null;

        if ('acquire' in seek) {
            const {acquire: resourceType} = seek;
            choices = ifilter(choices, ({job, task}) => {
                const prov
                    = job ? jobProvides(job)
                    : task ? taskProvides(task)
                    : null;
                return prov ? prov.resourceType == resourceType : false;
            });
        }

        if ('capacity' in seek) {
            const {capacity: capType, min} = seek;
            const need = creep.store.getFreeCapacity(capType) - min;
            if (need <= 0) return {ok: true, reason: 'seek capacity noop'};

            const haves = Array.from(storeEntries(creep.store))
                .sort(([_ra, a], [_rb, b]) => b - a);
            if (!haves.length) return {ok: false, reason: 'cannot seek capacity: have nothing'};

            const [resourceType, _have] = haves[0];
            choices = ifilter(choices, ({job, task}) => {
                const prov
                    = job ? jobConsumes(job)
                    : task ? taskConsumes(task)
                    : null;
                return prov ? prov.resourceType == resourceType : false;
            });
            // TODO transfer to storage before dropping
            fallback = {do: 'drop', resourceType};
        }

        if ('scoreOver' in seek) {
            const {scoreOver} = seek;
            choices = ifilter(choices, choice => scoreOf(choice) > scoreOver);
        }

        choices = debugChoices(debugLevel, `TaskFor[${creep.name}]`, bestChoice, choices);
        for (const {task, job} of choices) {
            let arg = job ? {jobName: job.name, ...(task || job.task)} : task ? task : null;
            if (!arg) continue;
            const res = this.planCreepTask(creep, arg);
            if (res.ok && res.nextTask) return resolveTaskThen(seek, res);
        }

        if (fallback) {
            const res = this.planCreepTask(creep, fallback);
            if (res.ok && res.nextTask) return res;
        }

        if (seek.must)
            return resolveTaskThen(seek, {ok: false, reason: 'cannot find available task'});

        return null;
    }

    /**
     * @param {Creep} creep
     * @param {Set<string>} oldJobNames
     * @param {Set<string>} newJobNames
     * @returns {void}
     */
    updateAssignedJobs(creep, oldJobNames, newJobNames) {
        const creepId = creep.id;
        for (const oldJobName of oldJobNames) if (!newJobNames.has(oldJobName))
            for (const oldJob of lookupJob(oldJobName, creep)) {
                if (oldJob.assigned) {
                    oldJob.assigned = oldJob.assigned.filter(id => id != creepId);
                }
            }
        for (const jobName of newJobNames) if (!oldJobNames.has(jobName))
            for (const newJob of lookupJob(jobName, creep)) {
                const ids = new Set(newJob.assigned);
                ids.add(creepId);
                newJob.assigned = [...ids];
            }
    }

    /**
     * @param {Creep} creep
     * @param {ActionTask} task
     * @returns {TaskResult|null}
     */
    execCreepAction(creep, task) {
        // yield if the creep has already acted this turn
        if (hasActed(creep)) return null;
        creep.memory.lastActed = Game.time;

        const {code, target} = this.dispatchCreepAction(creep, task);

        // TODO decouple into a wrapper/loop task?
        if (code === ERR_NOT_IN_RANGE) {
            if (!target) return resolveTaskThen(task, {ok: false, reason: 'no target'});
            creep.moveTo(target);
            return null;
        }

        return resolveTaskThen(task, {code, ok: code == OK, reason: `code ${code}`});
    }

    /**
     * @param {Creep} creep
     * @param {ActionTask} task
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

        case "drop":
            return {
                code: creep.drop(task.resourceType, task.amount),
            };

        case 'wander':
            const direction = moveDirections[Math.floor(Math.random() * moveDirections.length)];
            return {code: creep.move(direction)};

        default:
            assertNever(task, 'invalid creep action');
        }
    }

    /**
     * @param {Creep} creep
     * @returns {Generator<SeekChoice>}
     */
    *availableCreepTasks(creep) {
        for (const [source, jobs] of jobSources(creep)) {
            if (source instanceof Room)
                this.updateRoomJobs(source);
            yield* this.rateCreepJobs(creep, Object.values(jobs.byName));
        }
    }

    /**
     * @param {Creep} creep
     * @param {Iterable<Job>} jobs
     * @returns {Generator<SeekChoice>}
     */
    *rateCreepJobs(creep, jobs) {
        for (const job of jobs) {
            const scored = collectScores(this.rateCreepJob(creep, job));
            const score = scoreOf(scored);
            if (isNaN(score) || score <= 0) continue;
            yield {job, ...scored};
        }
    }

    /**
     * @param {Creep} creep
     * @param {Job} job
     * @returns {Generator<[string, number]>}
     */
    *rateCreepJob(creep, job) {
        const {
            assigned=[],
            requirements: {
                assign: {
                    min: minAssigned=1,
                    max: maxAssigned=NaN,
                } = {},
                ...requirements
            } = {},
            task,
        } = job;

        // pass any pre-computed job score factors
        for (const [name, factor] of scoreEntries(job)) yield [`job_${name}`, factor];

        // penalize score linearly after minimum is reached, clipping to NaN
        // after any maximum
        const numAssigned = assigned.length;
        const overAssigned = numAssigned >= maxAssigned
            ? NaN : Math.max(0, 1 + numAssigned - minAssigned);
        yield ['assigned', 1/(1 + overAssigned)];

        yield* this.rateCreepTask(creep, task, requirements);
    }

    /**
     * @param {Creep} creep
     * @param {Task} task
     * @param {TaskRequirements} requirements
     * @returns {Generator<[string, number]>}
     */
    *rateCreepTask(creep, task, {
        range=NaN,
        moveRate=isNaN(range) ? NaN : defaultMoveRate,
        parts,
        capacity,
        resources,
    }) {
        // pass any pre-computed task score factors
        for (const [name, factor] of scoreEntries(task)) yield [`task_${name}`, factor];

        // score range to target
        const target = taskTarget(task);
        const rangeTo = target
            ? creep.pos.getRangeTo(target) - range
            : NaN;
        if (!isNaN(rangeTo)) yield ['distance',
            Math.max(0, Math.min(1, 1 - rangeTo / ROOM_DIAG))
            // TODO fix cross-room case; currently it's taken to hard zero
        ];

        // score movement if required or needed
        if (rangeTo && !isNaN(moveRate)) {
            // TODO this assumes movement over land; can we do a better
            // estimate without incurring full pathfinding cost?
            let move = 0, weight = 0;
            for (const {type, hits} of creep.body) if (hits > 0) switch (type) {
                case MOVE:
                    move++;
                    break;
                // TODO case CARRY: discount carry parts if empty... and
                // depending on if we plan to change that
                default:
                    weight++;
            }
            yield ['movement', move <= 0 ? 0 : weight <= 0 ? 1 : move/weight];
        }

        // TODO combine distance and movement into a travel time based score?

        // score required body parts
        let maxPartCount = NaN;
        for (const [part, min] of reqSpecEntries(parts, 1)) if (part) {
            if (isNaN(maxPartCount)) {
                const maxBodypart = maxActiveBodypart(creep);
                maxPartCount = maxBodypart ? maxBodypart[1] : 0;
            }
            const count = creep.getActiveBodyparts(part);
            yield [`${part}Can`, maxPartCount == 0 || count < min
                ? NaN
                : count / maxPartCount];
        }

        // score required carrying capacity
        for (const [resource, min] of reqSpecEntries(capacity, 1)) {
            const free = resource
                ? creep.store.getFreeCapacity(resource)
                : creep.store.getFreeCapacity();
            yield [`${resource || ''}CarryFree`, free < min
                ? 0.2 // TODO discouraged due to the only option being "drop it" ; rank up once transfer-to-storage becomes available
                : 1];
        }

        // score required resources
        for (const [resource, min] of reqSpecEntries(resources, 1)) {
            const have = resource
                ? creep.store.getUsedCapacity(resource)
                : creep.store.getUsedCapacity();
            yield [`${resource || ''}Have`, have < min
                ? 0.5 // TODO better estimate of prereq cost
                : 1];
        }
    }

    /**
     * @param {Room} room
     * @returns {Generator<JobData>}
     */
    *availableRoomJobs(room) {
        // TODO config from memory
        const maintainControllerDeadline = 2 * ROOM_QUAD;
        const priority = {
            harvestEnergy: 0.10,
            upgradeController: 0.60,
            fillEnergy: 0.75,
            build: 0.80,
            maintainController: 0.90,
            pickup: 0.95,
        };

        // TODO clear tombstones... but should those be posted by the reaper?

        for (const {id, resourceType} of this.find(room, FIND_DROPPED_RESOURCES)) yield {
            name: `pickup_${id}`,
            requirements: {
                parts: [CARRY],
                capacity: [resourceType], // TODO require capacity for amount?
            },
            scoreFactors: {
                priority: priority.pickup,
                // TODO decay into account
            },
            task: {do: 'pickup', targetId: id},
        };

        for (const struct of this.find(room, FIND_MY_STRUCTURES)) switch (struct.structureType) {

            case STRUCTURE_SPAWN:
            case STRUCTURE_EXTENSION:
                if (struct.store.getFreeCapacity(RESOURCE_ENERGY) > 0) yield {
                    name: `fillEnergy_${struct.id}`,
                    requirements: {
                        parts: [CARRY],
                        resources: [RESOURCE_ENERGY],
                        // TODO require "enough" energy to have significant contribution?
                    },
                    scoreFactors: {
                        priority: priority.fillEnergy,
                    },
                    task: {
                        doUntil: {or: [
                            {empty: RESOURCE_ENERGY},
                            {code: ERR_NOT_ENOUGH_RESOURCES},
                        ]},
                        then: {
                            do: 'transfer',
                            targetId: struct.id,
                            resourceType: RESOURCE_ENERGY,
                        },
                    },
                };
                break;

            // TODO other structure types, like general repair
        }

        for (const {id} of this.find(room, FIND_CONSTRUCTION_SITES)) yield {
            name: `buildThings_${id}`,
            requirements: {
                parts: [WORK, CARRY],
                resources: [RESOURCE_ENERGY],
            },
            scoreFactors: {
                priority: priority.build,
                // TODO score progress/progressTotal
                // TODO priority by building type
                // TODO require "enough" energy to have significant contribution?
            },
            task: {
                doUntil: {or: [
                    {empty: RESOURCE_ENERGY},
                    {code: ERR_NOT_ENOUGH_RESOURCES},
                ]},
                then: {
                    do: 'build',
                    targetId: id,
                },
            },
        };

        const ctl = room.controller;
        if (ctl && ctl.my && !ctl.upgradeBlocked) yield {
            name: `upgradeController_${ctl.id}`,
            requirements: {
                parts: [WORK, CARRY],
                resources: [RESOURCE_ENERGY],
            },
            scoreFactors: {
                priority: ctl.ticksToDowngrade <= maintainControllerDeadline
                    ? priority.maintainController
                    : priority.upgradeController,
                // TODO score progress/progressTotal
                // TODO require "enough" energy to have significant contribution?
            },
            task: {
                doUntil: {or: [
                    {empty: RESOURCE_ENERGY},
                    {code: ERR_NOT_ENOUGH_RESOURCES},
                ]},
                then: {
                    do: 'upgradeController',
                    targetId: ctl.id,
                },
            },
        };

        for (const {id, energy, energyCapacity} of this.find(room, FIND_SOURCES_ACTIVE)) yield {
            name: `harvest_${id}`,
            requirements: {
                parts: [WORK, CARRY],
                capacity: [RESOURCE_ENERGY],
            },
            scoreFactors: {
                priority: priority.harvestEnergy,
                // TODO factor in availability
            },
            task: {
                doUntil: {full: RESOURCE_ENERGY},
                then: {
                    do: 'harvest',
                    targetId: id,
                }
            },
        };

        // TODO harvest minerals

        // TODO repair jobs? rampart maintenance? heal jobs? attack jobs? pull jobs? follow jobs?
    }

    /**
     * @param {Room} room
     * @param {number} [updateEvery]
     */
    updateRoomJobs(room, updateEvery=10) {
        room.memory.jobs = this.updateJobs(
            this.availableRoomJobs(room),
            room.memory.jobs, {
                updateEvery,
                desc: `in room ${room.name}`,
                debugLevel: this.debugLevel('jobs', room),
            });
    }

    /**
     * @param {Iterable<JobData>} available
     * @param {Jobs|undefined} jobs
     * @param {Object} [opts]
     * @param {number} [opts.updateEvery]
     * @param {string} [opts.desc]
     * @param {number} [opts.debugLevel]
     * @returns {Jobs}
     */
    updateJobs(available, jobs, opts={}) {
        const {
            updateEvery=1,
            desc='',
            debugLevel=this.debugLevel('jobs'),
        } = opts;

        if (!jobs) jobs = {
            lastUpdate: NaN,
            byName: {},
        };

        const nextUpdate = nanMin(jobs.nextUpdate, jobs.lastUpdate + updateEvery);
        if (Game.time < nextUpdate) return jobs;

        /** @type {Set<string>} */
        const seen = new Set();
        let changed = false;

        for (const newData of available) {
            const {name} = newData;
            seen.add(name);

            const job = name in jobs.byName ? jobs.byName[name] : null;
            const problems = Array.from(this.validateJob(name, job || newData));
            if (problems.length) {
                logJob('⚠️', name, `invalid job ${desc} because: ${problems.join('; ')}`);
                if (job) {
                    this.destroyJob(job);
                    delete jobs.byName[name];
                    changed = true;
                }
                continue;
            }

            if (debugLevel > 1) logJob('🔼', name, `${job ? 'update' : 'new'} job ${desc}`);

            if (job) {
                jobs.byName[name] = {
                    ...job,
                    ...newData,
                    lastUpdate: Game.time,
                    generated: true,
                };
            } else {
                jobs.byName[name] = {
                    ...newData,
                    createTime: Game.time,
                    lastUpdate: Game.time,
                    generated: true,
                };
            }
            changed = true;
        }

        for (const [name, job] of Object.entries(jobs.byName)) {
            if (seen.has(name)) continue; // created or updated above
            if (job.generated // auto-generated job, no longer available
                // TODO other forms of explicit "done"
            ) {
                if (debugLevel) logJob('✅', name, `done ${desc}`);
            } else {
                const problems = Array.from(this.validateJob(name, job));
                if (!problems.length) continue;
                logJob('⚠️', name, `deleting ${desc} because: ${problems.join('; ')}`);
            }

            this.destroyJob(job);
            delete jobs.byName[name];
            changed = true;
        }

        if (changed) jobs.lastUpdate = Game.time;
        jobs.nextUpdate = Object.values(jobs.byName)
            .map(({deadline, task: {deadline: taskDeadline}}) => nanMin(deadline, taskDeadline))
            .reduce(nanMin, Game.time + updateEvery);

        return jobs;
    }

    /**
     * @param {string} givenName
     * @param {Job|JobData} job
     * @returns {Generator<string>}
     */
    *validateJob(givenName, job) {
        const {name, deadline, task} = job;

        // validate fundamental name first
        if (name != givenName) yield 'given name mismatch';

        // then validate any metadata
        if ('createTime' in job) {
            const {createTime, lastUpdate, assigned} = job;
            if (createTime > Game.time) yield 'job from future';
            if (lastUpdate > Game.time) yield 'last update from future';
            if (assigned) {
                const stillAlive = /** @type {Creep[]} */ (assigned
                    .map(id => Game.getObjectById(id))
                    .filter(creep => !!creep));
                const stillAssigned = stillAlive.filter(({memory: {assigned}}) =>
                    assigned && isome(taskJobNames(assigned.task), jobName => jobName == givenName));
                job.assigned = stillAssigned.map(({id}) => id);
            }
        }

        // finally validate job spec data
        if (typeof deadline == 'number' && deadline < Game.time) yield 'deadline expired';
        const targetId = taskTargetId(task);
        if (targetId && !Game.getObjectById(targetId)) yield 'target gone';
    }

    /** @param {Job} job */
    destroyJob(job) {
        if (job.assigned) for (const id of job.assigned) {
            const creep = Game.getObjectById(id);
            if (!creep) continue;
            const {memory} = creep;
            const {assigned} = memory;
            if (!assigned) continue;
            let {task=null} = assigned;
            if (!task) continue;
            task = taskWithoutJob(task, job.name);
            if (task) assigned.task = task;
            else delete memory.assigned;
        }
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

/** @param {Creep} creep */
function hasActed(creep, since=Game.time) {
    const {memory: {lastActed}} = creep;
    return lastActed != null && lastActed >= since;
}

/**
 * @param {Task} task
 * @returns {null|RoomObject}
 */
function taskTarget(task) {
    const targetId = taskTargetId(task);
    return targetId && Game.getObjectById(targetId);
}

/**
 * @param {Task} task
 * @returns {Id<RoomObject>|null}
 */
function taskTargetId(task) {
    if (!('targetId' in task)) return null;
    return task.targetId;
}

/**
 * @param {Job} job
 * @returns {{resourceType: ResourceConstant, takes?: number}|null}
 */
function jobConsumes(job) {
    return taskConsumes(job.task);
}

/**
 * @param {Task} task
 * @returns {{resourceType: ResourceConstant, takes?: number}|null}
 */
function taskConsumes(task) {
    if (!('do' in task)) return null;
    switch (task.do) {
        case 'build':
            return {resourceType: RESOURCE_ENERGY/* TODO take: progressTotal - progress */};
        case 'transfer':
            return {resourceType: task.resourceType, takes: task.amount};
        case 'upgradeController':
            return {resourceType: RESOURCE_ENERGY};

        case 'harvest':
        case 'pickup':
        case 'wander':
            return null;

        default:
            assertNever(task, 'unknown do task provides');
    }
}

/**
 * @param {Job} job
 * @returns {{resourceType: ResourceConstant, avail?: number}|null}
 */
function jobProvides(job) {
    return taskProvides(job.task);
}

/**
 * @param {Task} task
 * @returns {{resourceType: ResourceConstant, avail?: number}|null}
 */
function taskProvides(task) {
    if (!('do' in task)) return null;
    switch (task.do) {
        case 'harvest':
            const target = Game.getObjectById(task.targetId);
            if (target instanceof Source) return {resourceType: RESOURCE_ENERGY, avail: target.energy};
            if (target instanceof Deposit) return {resourceType: target.depositType};
            if (target instanceof Mineral) return {resourceType: target.mineralType, avail: target.mineralAmount};
            return null;

        case 'build':
        case 'pickup':
        case 'transfer':
        case 'upgradeController':
        case 'wander':
            return null;

        default:
            assertNever(task, 'unknown do task provides');
    }
}

/**
 * @template {string} T
 * @param {undefined|number|ReqSpecs<T>} spec
 * @param {number} [dflt]
 * @returns {Generator<[null|T, number]>}
 */
function* reqSpecEntries(spec, dflt=0) {
    if (typeof spec == 'number')
        yield [null, spec];
    else if (spec) for (const item of spec)
        yield Array.isArray(item) ? item : [item, dflt];
}

/**
 * @param {StoreDefinition} store
 * @returns {Generator<[ResourceConstant, number]>}
 */
function* storeEntries(store) {
    for (const [key, have] of Object.entries(store)) {
        const resourceType = /** @type {ResourceConstant} */ (key);
        if (typeof have == 'number')
            yield [resourceType, have];
    }
}

/**
 * @param {JobSource} [subject]
 * @returns {Generator<[JobSource|null, Jobs]>}
 */
function *jobSources(subject) {
    if (subject) {
        const {memory: {jobs}} = subject;
        if (jobs) yield [subject, jobs];
        if ('room' in subject) {
            const {room} = subject;
            const {memory: {jobs: roomJobs}} = room;
            if (roomJobs) yield [room, roomJobs];
        }
    }
    const {jobs: globalJobs} = Memory;
    if (globalJobs) yield [null, globalJobs];
}

/**
 * @param {string} jobName
 * @param {JobSource} [subject]
 * @returns {Generator<Job>}
 */
function *lookupJob(jobName, subject) {
    for (const [_source, jobs] of jobSources(subject))
        if (jobName in jobs.byName)
            yield jobs.byName[jobName];
}

/**
 * @param {Task[]} tasks
 * @returns {Generator<string>}
 */
function *taskJobNames(...tasks) {
    for (const task of tasks) {
        const {jobName} = task;
        if (jobName) yield jobName;
        const arg = argTask(task.arg);
        if (arg) yield* taskJobNames(arg);
        if ('anyOf' in task) yield* taskJobNames(...task.anyOf);
        if ('allOf' in task) yield* taskJobNames(...task.allOf);
        if ('ctx' in task && task.ctx)
            for (const ctxTask of Object.values(task.ctx))
                yield* taskJobNames(ctxTask);
        for (const {task: nextTask} of thenTasks(task))
            yield* taskJobNames(nextTask);
    }
}

/**
 * @template {Task} T
 * @param {T} task
 * @param {string} jobName
 * @returns {T|null}
 */
function taskWithoutJob(task, jobName) {
    if (task.jobName == jobName) return null;
    const arg = task.arg;
    if (arg) {
        if ('task' in arg) {
            const wotask = taskWithoutJob(arg.task, jobName);
            if (wotask) task.arg = {task: wotask};
            else delete task.arg;
        } else if ('result' in arg) {
            let {nextTask, ...result} = arg.result;
            nextTask = nextTask && taskWithoutJob(nextTask, jobName) || undefined;
            task.arg = {result: {...result, nextTask}};
        }
    }
    if ('anyOf' in task) {
        task.anyOf = filterTasks(task.anyOf);
        if (!task.anyOf.length) return null;
    }
    if ('ctx' in task && task.ctx)
        for (const [name, ctxTask] of Object.entries(task.ctx)) {
            const woctx = taskWithoutJob(ctxTask, jobName);
            if (woctx) task.ctx[name] = woctx;
            else delete task.ctx[name];
        }
    for (const {task: nextTask, update} of thenTasks(task))
        update(taskWithoutJob(nextTask, jobName));
    return task;

    /** @param {Task[]} tasks */
    function filterTasks(tasks) {
        return /** @type {Task[]} */ (tasks
            .map(subTask => taskWithoutJob(subTask, jobName))
            .filter(subTask => !!subTask));
    }
}

const allBodyparts = [
    MOVE,
    WORK,
    CARRY,
    ATTACK,
    RANGED_ATTACK,
    HEAL,
    TOUGH,
];

/**
 * @param {Creep} creep
 * @returns {null|[BodyPartConstant, number]}
 */
function maxActiveBodypart(creep) {
    /** @type {null|BodyPartConstant} */
    let best = null;
    let max = 0;
    for (const part of allBodyparts) {
        const count = creep.getActiveBodyparts(part);
        if (count > max) {
            best = part;
            max = count;
        }
    }
    if (best == null) return null;
    return [best, max];
}

/**
 * @param {Task} task
 * @param {TaskResult|null} res
 * @returns {TaskResult|null}
 */
function resolveTaskThen(task, res) {
    return resolveThen(task.then, res);
}

/**
 * @param {TaskThen|undefined} then
 * @param {TaskResult|null} res
 * @returns {TaskResult|null}
 */
function resolveThen(then, res) {
    if (!then || !res) return res;
    const {nextTask: resTask, ...result} = res;
    return {...result, nextTask: resTask
        ? appendTaskThen(resTask, then)
        : chooseThenTask(then, res.ok)};
}

/**
 * @param {TaskThen} then
 * @param {boolean} resOk
 * @returns {Task|undefined}
 */
function chooseThenTask(then, resOk) {
    const {ok, fail} = unpackTaskThen(then);
    return resOk ? ok : fail;
}

/**
 * @param {Task} task
 * @param {TaskThen} then
 * @returns {Task}
 */
function appendTaskThen(task, then) {
    const {ok: thenOk, fail: thenFail} = unpackTaskThen(then);
    let tip = task;
    while (tip.then) {
        const {ok, fail} = unpackTaskThen(tip.then);
        if (ok) {
            tip.then = makeTaskThen(ok, fail);
            tip = ok;
        } else {
            if (fail && thenFail) {
                if (thenOk) tip.then = {ok: thenOk, fail};
                appendTaskThen(fail, {fail: thenFail});
            } else {
                tip.then = makeTaskThen(thenOk, fail || thenFail);
            }
            return task;
        }
    }
    tip.then = then;
    return task;
}

/**
 * @param {Task|undefined} ok
 * @param {Task|undefined} fail
 * @returns {TaskThen|undefined}
 */
function makeTaskThen(ok, fail) {
    if (ok && fail) return {ok, fail};
    else if (ok) return ok;
    else if (fail) return {fail};
    return undefined;
}

/**
 * @param {TaskThen} [then]
 * @param {Task} task
 * @returns {Task|undefined}
 */
function taskThenOk(task) {
    return task.then && thenOk(task.then);
}

/**
 * @param {Task} task
 * @returns {Task|undefined}
 */
function taskThenFail(task) {
    return task.then && thenFail(task.then);
}

/**
 * @param {TaskThen} then
 * @returns {Task|undefined}
 */
function thenOk(then) {
    return ('ok' in then) ? then.ok
         : ('fail' in then) ? undefined
         : then;
}

/**
 * @param {TaskThen} then
 * @returns {Task|undefined}
 */
function thenFail(then) {
    return ('ok' in then) ? then.ok
         : ('fail' in then) ? undefined
         : then;
}

/**
 * @param {TaskThen} [then]
 * @returns {{ok?: Task, fail?: Task}}
 */
function unpackTaskThen(then) {
    if (!then) return {};
    if ('ok' in then) {
        const {ok} = then;
        const fail = 'fail' in then ? then.fail : undefined;
        return {ok, fail};
    }
    if ('fail' in then) {
        const {fail} = then;
        return {fail};
    }
    return {ok: then};
}

/**
 * @param {Task} task
 * @returns {Generator<{task: Task, update: (task: Task|null) => void}>}
 */
function *thenTasks(task) {
    for (const {then, update} of taskThens(task)) yield {
        task: then,
        update: task => {
            if (!task) update(null);
            else update(task);
        },
    };
}

/**
 * @param {Task} task
 * @returns {Generator<{then: Task, update: (thenTask: Task|null) => void}>}
 */
function *taskThens(task) {
    if (!task.then) return;
    const {then} = task;
    if (!('ok' in then) && !('fail' in then)) {
        yield {then, update: thenTask => {
            if (thenTask) task.then = thenTask;
            else delete task.then;
        }};
    } else {
        if ('ok' in then) yield {then: then.ok, update: thenTask => {
            if (thenTask) then.ok = thenTask;
            else if ('fail' in then) task.then = {fail: then.fail};
            else delete task.then;
        }};
        if ('fail' in then) yield {then: then.fail, update: thenTask => {
            if (thenTask) then.fail = thenTask;
            else if ('ok' in then) task.then = {ok: then.ok};
            else delete task.then;
        }};
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
function logJob(mark, name, ...mess) { log(mark, 'Jobs', name, ...mess); }

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
 * @param {Scored} object
 * @returns {number}
 */
function scoreOf(object) {
    let {score, scoreFactors} = object;
    if (typeof score != 'number' || isNaN(score)) {
        object.score = score = scoreFactors
            ? Object.values(scoreFactors)
                .reduce((a, b) => a * b, 1)
            : 0;
    }
    return score;
}

/**
 * @param {Iterable<[string, number]>} factorEntries
 * @returns {Scored}
 */
function collectScores(factorEntries) {
    let score = 1;
    /** @type {Object<string, number>} */
    const scoreFactors = {};
    for (const [name, factor] of factorEntries) {
        scoreFactors[name] = factor;
        score *= factor;
    }
    return {score, scoreFactors};
}

/**
 * @param {Scored} object
 * @returns {Generator<[string, number]>}
 */
function *scoreEntries(object) {
    const {score, scoreFactors} = object;
    if (scoreFactors)
        yield* Object.entries(scoreFactors);
    else if (typeof score == 'number')
        yield ['jobScore', score];
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
 * @template {(Object & Scored)} T
 * @param {Iterable<T>} choices
 * @returns {Generator<T>}
 */
function *bestChoice(choices) {
    /** @type {Heap<T>} */
    const heap = {
        items: Array.from(choices),
        better: betterItemScore,
    };
    heapify(heap);
    for (;;) {
        const value = heappop(heap);
        if (value === undefined) break;
        yield value;
    }
}

/**
 * @param {(Object & {score?: number})[]} items
 * @param {number} i
 * @param {number} j
 */
function betterItemScore(items, i, j) {
    const iScore = scoreOf(items[i]);
    const jScore = scoreOf(items[j]);
    return iScore > jScore;
}

/**
 * @template T
 * @typedef {Object} Heap
 * @prop {T[]} items
 * @prop {(ar: T[], i: number, j: number) => boolean} better
 */

/**
 * @template T
 * @param {Heap<T>} heap
 */
function heapify(heap) {
    const {items} = heap;
    for (let i = Math.floor(items.length/2) - 1; i >= 0; i--)
        siftdown(heap, i);
}

/**
 * @template T
 * @param {Heap<T>} heap
 */
function heappop(heap) {
    const {items} = heap;
    const end = items.length - 1;
    if (end > 0) {
        [items[0], items[end]] = [items[end], items[0]];
        siftdown(heap, 0, end);
    }
    return items.pop();
}

/**
 * @template T
 * @param {Heap<T>} heap
 * @param {number} i
 */
function siftdown({items, better}, i, end=items.length-1) {
    let root = i;
    while (root <= end) {
        const left = 2 * root + 1;
        if (left > end) break;
        const right = left + 1;
        const child = right < end && better(items, right, left) ? right : left;
        if (!better(items, child, root)) break;
        [items[root], items[child]] = [items[child], items[root]];
        root = child;
    }
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
 * @template T
 * @param {Iterable<T>} it
 * @param {(v: T) => boolean} fn
 * @returns {Generator<T>}
 */
function *ifilter(it, fn) {
    for (const v of it)
        if (fn(v))
            yield v;
}

/**
 * @template T
 * @param {Iterable<T>} it
 * @param {(v: T) => boolean} [fn]
 * @returns {T|null}
 */
function ifirst(it, fn) {
    for (const v of it)
        if (!fn || fn(v)) return v;
    return null;
}

/**
 * @template T
 * @param {Iterable<T>} it
 * @param {(v: T) => boolean} fn
 * @returns {boolean}
 */
function isome(it, fn) {
    for (const v of it)
        if (fn(v)) return true;
    return false;
}

/**
 * @template A,B
 * @param {Iterable<A>} it
 * @param {(v: A) => B} fn
 * @returns {Generator<B>}
 */
function *imap(it, fn) {
    for (const v of it)
        yield fn(v);
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
