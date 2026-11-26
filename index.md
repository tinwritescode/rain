---
layout: home
titleTemplate: Calm-senior backend mode for AI agents

hero:
  name: rAIn
  text: Backend code that is still right at 2am.
  tagline: A Claude Code skill that gives your agent the boring habits behind production-safe services. Retries that answer 200, owner locks, webhooks you can replay, local mirrors of every remote object.
  actions:
    - theme: brand
      text: Install
      link: '#install'
    - theme: alt
      text: Read the rules
      link: /skills/rain/SKILL
    - theme: alt
      text: See the examples
      link: /examples/README

features:
  - title: Retries answer 200, not 409
    details: Every state change checks the current state first. Running it twice changes nothing, so callers can retry after a timeout.
  - title: Lock the owner, then recheck
    details: One transaction per use case. Lock the aggregate that owns the change, refresh the row, re-read its status.
  - title: Webhooks you can replay
    details: Verify the signature, store the event by delivery id, dispatch, drop stale events. replayEvent(id) after a bug fix.
  - title: Local mirrors
    details: Each remote object you depend on gets a table with its raw payload, so a lookup never waits on a rate limit.
  - title: /rain review
    details: Reads a branch diff and every function it touches, then lists violations as file:line | rule | fix, concurrency first.
    link: /examples/review/close-without-rain
    linkText: Sample review
  - title: Honest examples
    details: Three tasks, run with and without rAIn on the same model and prompt. Real diffs, trade-offs included.
    link: /examples/README
    linkText: Diffs and numbers
---

<!--@include: ./README.md#install-->

<!--@include: ./README.md#before-after-->
