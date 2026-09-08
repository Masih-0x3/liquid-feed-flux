# CircleCI parity job

`.circleci/config.yml` runs the reviewed `lint-build` job from
`.github/workflows/ci.yml` on a CircleCI machine executor. The parity runner
(`scripts/run-circleci-parity.mjs`) derives the ordered `run` steps from that
workflow at execution time and fails closed if the workflow grammar, immutable
action references, checkout expression, Node 24 setup, or supply-chain
boundaries change unexpectedly. This keeps the CircleCI job from becoming an
unchecked second copy of the 157-step GitHub job.

The machine executor is required because the hosted supply-chain collector
builds the renderer image locally and scans it through the host Docker socket.
The job selects Node 24 through the machine image's `nvm` installation and
requires npm 11 before the derived checks begin. After selection, the setup
step persists the resolved Node 24 `bin` directory in `BASH_ENV` and verifies a
nounset child shell, rather than re-sourcing `nvm.sh` in every child command.
This keeps shell startup configuration from falling back to the machine image's
Node version. CircleCI's built-in checkout must leave `git rev-parse HEAD`
equal to `CIRCLE_SHA1`; otherwise the runner fails before executing checks.

There are two CircleCI artifact boundaries matching the GitHub workflow:

1. The first run stage collects the redacted pending evidence bundle, then
   `store_artifacts` retains it before technical validation and mutable tests.
2. The second run stage performs technical validation, all remaining checks and
   the exact-head owner disposition. Only after that command succeeds and
   the CircleCI parity tests pass with the owner-policy variable removed does
   `validation.json` get checked for `passed_owner_accepted` and a separate
   accepted bundle get copied for `store_artifacts`; a failed post-collection
   stage cannot relabel the pending bundle as accepted. Missing artifacts or
   any failed command block the job.

The runner removes `XOT_SUPPLY_OWNER_POLICY_B64` from every derived command
until the final owner-validation command. It also removes `BASH_ENV` from each
derived child while retaining the setup step's resolved Node 24 `PATH`, so
Circle's bootstrap shell configuration cannot be re-entered under `nounset`.
Configure the owner policy as a protected CircleCI project/context environment
variable; it is never committed or printed by this job. The final command still requires
`XOT_SUPPLY_OWNER_POLICY_MODE=exact-head`, an exact `CIRCLE_SHA1`, and an
owner-policy payload matching the current technical evidence.

The workflow intentionally has no branch filter so pull-request branches and
main pushes both receive the checks. This is broader than the GitHub workflow's
event filter, but does not reduce coverage; repository branch protection should
select the CircleCI check only after the CircleCI project and context are
verified externally. A committed config and passing local parity tests are not
hosted CircleCI acceptance evidence.
