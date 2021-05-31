# My Screeps Code

This repository contains my sporadic progress on playing the
[screep](https://screeps.com/) programming game.

# Status

I'm still in what I'd consider a "pre-game research and experimentation" phase:
not yet playing in / running this code on any persistent server.

My current development cycle has been oscillating between phases of
read the docs, offline coding, and tinkering around on a local server.

Branches:
- `main` is the last code that was actually played/validated in game
- `rc` is the next candidate code to be played, and has passed some degree of
  pre-game validation (type checking, code review, and maybe someday tests)
- `dev` is the current unvalidated the sandbox
  - the current focus of development is the Job system aspirationally described
    below; only Tasks are currently working on the main branch

# Architecture / Decisions

## Tasks (and soon Jobs) not Roles

After reading tutorial code, I came away with a strong response of "Just Say No
To Static Role Based Behavior". Instead I'm going for a job and task oriented
system.

A Job is a high level goal:
- Set in any of Global, Room, or a Creep's internal memory
- Room jobs are the primary scope for now tho, being automatically generated
  and updated based on room conditions
- Global jobs may eventually be used to encode manual player instruction, or
  directives from other systems
- Creep jobs may eventually be generated in reaction to creep experience.
  Another potential use for creep jobs would be under a party mechanism, a
  party leaders jobs would be followed by other party members
- Other potential uses include Flag and Spawn attached jobs, with flags being
  perhaps an even better way to integrate user feedback

A Task is a low level action item:
- They mostly map onto atomic creep actions like harvest or build
  - Move-to target is auotmaed handled if an action fails with range error
  - Repetition clauses are provided for things like "harvest until full" or
    "build until empty"
- In addition to basic "do an action" tasks, a random-movement wandering task
  is used for default creep behavior when no other task is available
- They may have a deadline for things like time-limited tasks (pick this item
  up before it decays) or to say "wander for N ticks"
- A task may have a "then" field which specifies a follow-up task; this can be
  used for things like movement planning, or pre-requisite gathering

Jobs are scored according to priority within their scope (e.g. Room) and track
how many creeps are already assigned and requirements like creep capability,
resources, or creep carrying capacity.

An unassigned creep then generates and chooses a task by filtering and scoring
available jobs based on its capability and situation. Intrinsic job priority
scores are attenuated based on how many creeps are already assigned, providing
an element of fairness, while also allowing over subscription, rather than
allowing a creep to wander idly.

Currently creeps perform a hard filter for required resources, but may
eventually plan something like a "harvest-then-build" task chain against a
build job. Such a task's score would need to be attenuated for the harvesting
cost of course. This should allow for a form of priority inversion: since
harvesting is usually low priority, but it may need to be transitively
prioritized for an urgent build, before some other mid-priority job.

Another idea would be to add work stealing to this system, so that an untasked
creep first evaluates "can I do any already assigned task better than it's
current assignee?" before looking at any available job lists. As long as the
task scores are designed appropriately, this should be a Lyapunov stable
process...

# Style / Philosophy

I prefer to write modern tooling agnostic JavaScript, annotated for type
checking, but avoid using a transpiler. This approach is inspired by
[properjs.org](http://properjs.org/).

While this can be mildly frustrating when writing to an aging target (ES2017
lacking the existential operator in this case), I prefer that tradeoff rather
than needing a heavy build chain and the resulting runtime mismatch (or worse,
additional moving parts to map sources around...)

I'm also averse to breaking code up into many (usually too-small) modules, and
prefer the coherence of one file when possible. There may come a future point
where breaking a module out becomes worth it in this project, but not yet...
