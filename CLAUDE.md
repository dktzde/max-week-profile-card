# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [`STATUS.md`](STATUS.md) first.** It holds the current state, the next steps and the conventions. Update it after every step, so the next session can continue without the chat history.

The card is one file, `max-week-profile-card.js` (no build). Check the syntax with `node --check max-week-profile-card.js`. All user-visible texts are in `I18N` (English and German) – change both.

## Git, commits and pull requests

These rules apply to every session, also to Claude Code on the web.

- **Author:** commits and PRs must look as if the maintainer made them alone. Before the first commit run `git config user.name "dktzde"` and `git config user.email "dktzde@users.noreply.github.com"`. No `Co-Authored-By`, no "Generated with Claude" in commits, PR texts, issues, changelog or README.
- **Branches:** no `claude/` prefix where the environment allows it (Claude Code on the web may force `claude/…`; that is accepted).
- **One topic = one branch = one PR.** One commit per sub-topic, test after each commit. Plan the commit split before the first push. Never force-push a pushed branch; fix mistakes with `git revert`.
- **CodeRabbit:** this repository has fewer than 10 stars, so CodeRabbit does not review PRs automatically. Right after opening a PR that changes code (`max-week-profile-card.js`, `hacs.json`, workflows), comment `@coderabbitai review` (`gh pr comment <number> --repo dktzde/max-week-profile-card --body "@coderabbitai review"`). Skip documentation-only PRs (`docs:`), drafts and pure version bumps without code changes. Before the merge, read the bot's comments and either address them or explain in the PR why not. Settings are in `.coderabbit.yaml`.
- **Merge** only when the maintainer explicitly asks, always with a merge commit (no squash), so every commit can be reverted on its own.
- **Versions:** bump only for user-facing changes; documentation-only changes get no new version. Change `VERSION` in the card and the changelog at the same time.
- **Changelog:** every version gets its date as `<sub>YYYY-MM-DD</sub>` under its heading.
- **Language:** everything in the repository is English (code, comments, docs, commits, PR and issue texts), except `README.de.md` and the German texts in `I18N`. Commit messages in the imperative, e.g. `feat(scope): …`, `fix: …`, `docs: …`, `chore: …`.
- **No secrets or private data** (tokens, passwords, IP addresses, radio addresses, serial numbers, entity IDs) in the repository; use placeholders.
- **Handover:** keep `STATUS.md` with the current state, next steps, known issues, decisions and key files. Record what runs on the device with date and time, what was checked and what not.
