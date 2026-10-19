---
process: sprint-start
title: Start a sprint
category: Sprints
group: Delivery / Sprints
tags: jira, planning
owner: person-blake
context: sprint, capacity
roles: scrum-lead
---

## Before planning · DO-CONFIRM {#before}
- [!] {jira.sprint} Last sprint closed in Jira @scrum-lead {#close-last}
  action: close
  board: Web app board
  sprint: The active sprint
- [ ] {jira.sprint} Unfinished stories moved to the new sprint or the backlog @scrum-lead {#carryover}
  action: move-incomplete
  board: Web app board
  sprint: The sprint just closed
- [ ] {measure} Velocity of the last sprint recorded @scrum-lead {#velocity}
  metric: Story points completed in the last sprint
  unit: points
  where: Jira velocity chart
- [ ] {measure} Points carried over from the last sprint @scrum-lead {#carried-points}
  metric: Story points of the unfinished stories
  unit: points
- [ ] {measure} Capacity for the next two weeks, after time off @scrum-lead {#capacity}
  metric: Team capacity
  unit: person-days
  where: Team calendar
  sets: capacity
- [~] {ui.action} Sprint dates copied into the team roadmap @scrum-lead {#roadmap}
  system: Team roadmap

## Planning · READ-DO {#planning}
- [!] {meeting} Sprint planning with the whole team, sized to ^capacity person-days @scrum-lead {#meeting}
  attendees: Everyone
  at: 10:00
- [!] {confirm} Sprint goal agreed as one sentence {#goal}
  evidence: note
- [!] {confirm} Every committed story has acceptance criteria {#criteria}

## Gate: Sprint ready · owner @scrum-lead {#ready}
  approves: ^sprint
  due: 12:00

## After planning · DO-CONFIRM {#after}
- [!] {jira.sprint} Sprint started in Jira ^sprint @scrum-lead {#start}
  action: start
  board: Web app board
  sprint: ^sprint
- [ ] {jira.sprint} Sprint goal set in Jira @scrum-lead {#set-goal}
  action: set-goal
  board: Web app board
  sprint: ^sprint
  goal: The goal agreed in planning
- [ ] {communicate} Goal posted in the team channel @scrum-lead {#post}
  channel: #team
