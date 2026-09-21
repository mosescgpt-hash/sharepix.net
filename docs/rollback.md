# Putting the site back

What to do when a deploy turns out to be wrong, and what "a backup" does and
does not mean for a site built this way.

## The short version

| I want to… | Do this |
| --- | --- |
| Undo the last deploy, fast | **Amplify → Hosting → the previous build → Redeploy this version** |
| Undo it properly, so the next deploy does not bring it back | `git revert` the merge commit on `main` |
| See what the site looked like before a change | `git checkout rollback/<name>` and run it locally |

The first is the emergency lever and takes about a minute. It changes nothing in
this repository, so the *next* merge to `main` re-deploys the thing you just
rolled back. Use it to stop the bleeding, then do the second one.

## Rollback points

A branch is cut before a change big enough to want undoing. It is a name for a
commit, pointing at whatever `main` was serving at the time.

| Branch | Marks |
| --- | --- |
| `rollback/pre-homepage-2026-09-21` | Before the homepage rewrite (PR #146) — `c6721aa` |

An older marker, `pre-redesign-2026-09-04`, is a **tag** rather than a branch.
Both work; branches are used now because the deploy credentials in CI can push
`refs/heads/*` and cannot push `refs/tags/*`, so a tag has to be made by hand
from a workstation and quietly is not.

To cut a new one before a risky merge:

```
git fetch origin main
git branch rollback/pre-<thing>-<date> origin/main
git push -u origin rollback/pre-<thing>-<date>
```

## What a rollback branch actually covers

**The code, and nothing else.** That is the honest boundary, and it matters
more than it sounds.

| | Covered by a rollback branch? |
| --- | --- |
| Pages, copy, components, Lambda source | **Yes.** Revert and redeploy. |
| Backend shape — tables, IAM, functions | **Partly.** Reverting the CDK code removes what it added, but see below. |
| Guests' photos and videos in S3 and R2 | **No, and they do not need it.** Nothing in a deploy touches stored media. |
| Rows in DynamoDB — events, payments, refunds | **No.** A schema revert can orphan data that a new model created. |
| Amplify environment variables and secrets | **No.** They live in the console, not here. |

So: a copy change is trivially reversible. A change that added a **table** is
not symmetrical — reverting the code removes the model, but the table and its
rows persist until somebody deletes them, and a later re-deploy of the same
model may or may not adopt them. Prefer fixing forward for anything that
touched `amplify/data/resource.ts`.

## Rolling back the code

```
git fetch origin main
git checkout main && git pull
git revert -m 1 <merge-commit-sha>
git push origin main
```

`-m 1` is what makes this work on a squash-merge repository's merge commit —
it says "keep the first parent", i.e. the state before the branch landed.
Merging to `main` deploys, so the push is the deploy.

A revert is a new commit, not an erasure. The history stays honest and you can
revert the revert if it turns out the change was fine and something else was
wrong.

## Restoring media, which is a different problem

Photos and video are not in git and are never touched by a deploy. The thing
that *can* remove them is the **reclaim job**, and only when
`STORAGE_RECLAIM_ENABLED` is set — see [deploying.md](deploying.md). It is the
only job in this codebase that destroys data, which is why it has its own
switch and ships off.

There is no snapshot of the media buckets today. If that matters, S3 versioning
on the photos bucket is the thing to turn on, and it is not on now — saying so
here rather than letting this page imply a safety net that does not exist.

## What could not be captured

The **rendered** site. A build is reproducible from a commit, so the commit is
the artifact; there is no stored copy of the HTML Amplify served on a given day.
For a marketing change that is fine. If a future change needs a visual
before-and-after, take screenshots first — nothing in this repository does it
for you.
