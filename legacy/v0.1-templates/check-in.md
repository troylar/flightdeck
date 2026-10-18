---
title: Check in code
category: Code
owner: Author
when: Before every pull request
context: branch, commit
---

## Before the pull request · DO-CONFIRM
- [!] Branch rebased onto master ^commit
- [!] Full test gate green after the rebase ^commit
- [!] No secrets, real names or customer data in the diff
- [ ] Files committed by path, not with add-all
- [~] Jira key in the commit message

## Before the merge · DO-CONFIRM
- [!] One reviewer approved the current commit ^commit
- [ ] Release notes entry added for user-visible changes
