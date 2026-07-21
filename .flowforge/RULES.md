# 📜 Universal Development Rules for FlowForge Projects

<!--
Organization: FlowForge Team
Technical Lead: Alexandre Cruz (30+ years experience, AI/ML UT)
Repository: FlowForge
Version: 2.0.0
Last Updated: 2025-08-21
Status: Active - v2.0 Release
-->

## 🎯 Core Principles

Organization and discipline are the keys to good software. These rules ensure we maintain high standards and create maintainable, well-documented projects.

---

## 📋 Mandatory Rules

### 1. Documentation Organization
- ✅ **ALL documentation MUST be in `/documentation` directory**
- ✅ **ALL documentation MUST be linked from README.md**
- ✅ **ALL documentation MUST follow the header template with project info**
- ✅ **Exceptions: README.md, CLAUDE.md stay in root; .claude/, .flowforge/ and hidden directories are excluded**

### 2. Planning Before Implementation
- ✅ **Claude CANNOT start working without validating a plan with the developer**
- ✅ **Present at least 3 options for any implementation**
- ✅ **Clearly indicate which option Claude believes is best and WHY**
- ✅ **Wait for approval before proceeding**

### 3. Testing Requirements
- ✅ **ALL new implementations/features MUST have proper unit tests**
- ✅ **Test coverage must meet or exceed 80% for new code**
- ✅ **Integration tests for API endpoints**
- ✅ **E2E tests for critical workflows**

### 4. Documentation Updates
- ✅ **ALL changes to architecture MUST update relevant documentation**
- ✅ **ALL new features MUST have documentation**
- ✅ **ALL decisions MUST be documented with rationale**
- ✅ **Keep documentation in sync with code**

### 5. Universal Ticket Management
- ✅ **Claude MUST NOT work without a valid ticket from any configured provider**
- ✅ **Supported providers: GitHub Issues, Notion Pages, Linear Issues, Jira Tickets, Local JSON Tasks**
- ✅ **Set ticket to "In Progress" status when starting work**
- ✅ **Reference ticket ID in commits and documentation**
- ✅ **Close ticket when work is complete**

**Provider Examples:**
- **GitHub**: Issue #123 in repository
- **Notion**: Page/Task in database
- **Linear**: Issue LIN-123 in workspace
- **Jira**: Ticket PROJ-123 in project
- **Local**: Task 123 in .flowforge/tasks.json

**Universal Status Mapping:**
- ready → in_progress → review → completed

### 6. Task Tracking System
- ✅ **All tasks tracked in JSON format in .flowforge/tasks.json**
- ✅ **Record start time: YYYY-MM-DD HH:MM when beginning a task**
- ✅ **Record end time: YYYY-MM-DD HH:MM when completing a task**
- ✅ **Support multiple task providers (GitHub, Notion, custom)**
- ✅ **Update task status throughout the work using FlowForge commands**

### 7. Project Template Updates
- ✅ **Update PROJECT_TEMPLATE.md with any new rules or patterns**
- ✅ **Ensure template includes rules document creation**
- ✅ **Keep template current with best practices discovered**

### 8. Code Quality Standards
- ✅ **Follow established patterns from the codebase**
- ✅ **Maintain consistent code style**
- ✅ **No console.log statements in production code**
- ✅ **Proper error handling in all functions**

### 9. Communication
- ✅ **Always explain what you're doing and why**
- ✅ **Ask for clarification when requirements are unclear**
- ✅ **Report blockers immediately**
- ✅ **Provide regular progress updates**

### 10. Database Consistency
- ✅ **Mirror existing mnesis database schema initially**
- ✅ **Document any proposed changes before implementing**
- ✅ **Ensure API compatibility with frontend expectations**

### 11. Session Continuity
- ✅ **ALWAYS update .flowforge/tasks.json (via provider) at the end of each session**
- ✅ **Include current status, completed work, and next steps**
- ✅ **Update with any blockers or important decisions**
- ✅ **This ensures seamless continuation in next session**

### 12. Task Completion Approval
- ✅ **Claude CANNOT close any task without developer approval**
- ✅ **When Claude believes a task is complete, must ask for review**
- ✅ **Provide summary of what was done and testing performed**
- ✅ **Wait for explicit approval before marking as completed**
- ✅ **This ensures quality control and proper verification**

### 13. Living Documentation Principle
- ✅ **Documentation must be updated IMMEDIATELY when making architectural decisions**
- ✅ **Wrong/outdated documentation is worse than no documentation**
- ✅ **Every structural change, strategy decision, or database modification MUST be documented**
- ✅ **Documentation reflects our professional standards - it will be judged by others**
- ✅ **Keep documentation current, accurate, and truth-reflecting at all times**

### 14. Decision Documentation Requirements
- ✅ **ALL technical decisions must be documented with:**
  - The options considered (minimum 3 when presented)
  - The chosen option and WHY it was selected
  - Impact on the system architecture
  - Date and context of the decision
- ✅ **Create Architecture Decision Records (ADRs) for significant choices**
- ✅ **Update relevant documentation files immediately after implementation**

### 15. Documentation Organization Standards
- ✅ **File names must be consistent and self-explanatory**
- ✅ **Organize by logical categories (architecture/, api/, guides/, etc.)**
- ✅ **Avoid documentation bloat - quality over quantity**
- ✅ **Each document should have a clear purpose and audience**
- ✅ **Remove or archive outdated information promptly**

### 16. Infrastructure Documentation
- ✅ **Document all ports, services, and deployment configurations**
- ✅ **Keep track of environment-specific settings**
- ✅ **Document integration points with other services**
- ✅ **Update deployment guides when infrastructure changes**
- ✅ **Include rationale for infrastructure choices**

### 17. Task Context Documentation
- ✅ **ALWAYS update tasks with implementation context and decisions**
- ✅ **Document WHY something took the time it did (technical complexity, design decisions, etc.)**
- ✅ **Add progress comments to tasks explaining what approach was taken**
- ✅ **This prevents comparing "apples with oranges" when reviewing task duration**
- ✅ **Future team members need full context to understand implementation choices**
- ✅ **Use appropriate CLI tools or APIs to add comments (gh CLI for GitHub, Notion API for Notion, etc.)**

### 18. Git Flow Compliance
- ✅ **NEVER work directly on main or develop branches**
- ✅ **ALWAYS create feature branches: `git checkout -b feature/task-id-description`**
- ✅ **Follow branch naming: feature/*, bugfix/*, chore/*, hotfix/***
- ✅ **Create PR for code review before merging**
- ✅ **Reference task ID in branch name and commits**
- ✅ **Read GIT_FLOW.md before starting any work**

### 19. Database Change Protocol
- ✅ **NEVER create or modify database structure without approval**
- ✅ **ALWAYS present 3+ options for database design decisions**
- ✅ **Check existing database structure in documentation FIRST**
- ✅ **Verify what already exists in the actual database**
- ✅ **Present changes with rationale and impact analysis**
- ✅ **Update DATABASE.md immediately after approved changes**
- ✅ **Maintain ERD diagram for visual representation**
- ✅ **Consider relationships and normalization (e.g., addresses as separate table)**

### 20. Documentation First Principle
- ✅ **ALWAYS read relevant documentation before implementing**
- ✅ **Check DATABASE.md for existing schema**
- ✅ **Review API.md for endpoint specifications**
- ✅ **Verify requirements in issue description**
- ✅ **If documentation is missing or unclear, ask for clarification**
- ✅ **Documentation is the source of truth - code follows documentation**

### 21. No Shortcuts Without Discussion
- ✅ **NEVER take shortcuts when facing issues without discussing with the developer first**
- ✅ **ALWAYS explain the problem and the reasoning behind proposed shortcuts**
- ✅ **Present the issue clearly with context**
- ✅ **Suggest proper solutions alongside any shortcuts**
- ✅ **Only proceed with shortcuts after explicit approval**
- ✅ **Shortcuts often create technical debt - avoid them**

### 22. Check Task Tracking Before Starting
- ✅ **ALWAYS check .flowforge/tasks.json before starting a new task**
- ✅ **Verify if the task is already listed in the task tracking system**
- ✅ **If task isn't listed, add it following the task tracking rules**
- ✅ **Create a new task in your configured task provider for unlisted tasks**
- ✅ **This ensures no work is duplicated and all tasks are tracked**
- ✅ **Update the task tracking system with task details immediately**

### 23. Consistent Architecture and Patterns
- ✅ **Use consistent naming conventions across the entire codebase**
- ✅ **Follow established file structure patterns from existing code**
- ✅ **Adhere to architecture patterns described in documentation**
- ✅ **Check ARCHITECTURE.md, API.md, and relevant ADRs for patterns**
- ✅ **When in doubt, follow existing patterns in the codebase**
- ✅ **Consistency is more important than personal preferences**
- ✅ **Document any new patterns introduced with justification**

### 24. Code Organization and File Size Limits
- ✅ **Never create a NON-TEST file longer than 700 lines of code**
- ✅ **Test files (*.test.ts, *.spec.ts, *.test.js, *.spec.js) have NO line limit - they can be as long as needed**
- ✅ **If a non-test file approaches 700 lines, IMMEDIATELY refactor by splitting it into modules or helper files**
- ✅ **ENFORCEMENT: Agents MUST check file size DURING creation, not after**
- ✅ **Organize code into clearly separated modules, grouped by feature or responsibility**
- ✅ **Use clear, consistent imports (prefer relative imports within packages)**
- ✅ **Each file should have a single, clear purpose**
- ✅ **Extract complex logic into separate utility or helper files**
- ✅ **Keep services, repositories, and routes in separate files**

### 25. Testing & Reliability
- ✅ **Always create unit tests for new features (functions, classes, routes, etc)**
- ✅ **After updating any logic, check whether existing unit tests need to be updated. If so, do it**
- ✅ **Tests should live in a `/tests` folder mirroring the main app structure**
- ✅ **Include at least:**
  - 1 test for expected use
  - 1 edge case
  - 1 failure case
- ✅ **Test file names should match source files with `.test.ts` extension**
- ✅ **Run all tests before committing to ensure nothing is broken**
- ✅ **Maintain test coverage above 80% for all new code**

### 26. Function Documentation
- ✅ **Write documentation for every function, class, and method**
- ✅ **For Python projects, use Google style docstrings:**
  ```python
  def example(param1: str, param2: int) -> bool:
      """
      Brief summary.

      Args:
          param1 (str): Description.
          param2 (int): Description.

      Returns:
          bool: Description.
      """
  ```
- ✅ **For TypeScript/JavaScript projects, use JSDoc format:**
  ```typescript
  /**
   * Brief summary.
   * 
   * @param {string} param1 - Description
   * @param {number} param2 - Description
   * @returns {boolean} Description
   * @throws {Error} Description of when this error is thrown
   * @example
   * const result = example('value', 42)
   */
  ```
- ✅ **Document all public APIs and complex internal functions**
- ✅ **Include parameter types, return types, and possible exceptions**
- ✅ **Add usage examples for complex functions**
- ✅ **Keep documentation updated when function signatures change**

### 27. Documentation & Explainability
- ✅ **Update `README.md` and/or any other relevant documentation when new features are added, dependencies change, or setup steps are modified**
- ✅ **Comment non-obvious code and ensure everything is understandable to a mid-level developer**
- ✅ **When writing complex logic, add inline comments explaining the why, not just the what**
- ✅ **For complex algorithms or business logic, use `// Reason:` comments to explain decisions**
- ✅ **Document edge cases and assumptions in the code**
- ✅ **Keep comments concise but informative**
- ✅ **Update comments when code changes to avoid misleading documentation**
- ✅ **Prioritize code clarity - if you need to explain what the code does, consider refactoring for clarity first**

### 28. AI Behavior Rules
- ✅ **Never assume missing context. Ask questions if uncertain**
- ✅ **Never hallucinate libraries or functions – only use known, verified Python/TypeScript packages/libs**
- ✅ **Always confirm file paths and module names exist before referencing them in code or tests**
- ✅ **Never delete or overwrite existing code unless explicitly instructed to or if part of a task from workflow document/GitHub issue**
- ✅ **Check package.json or requirements.txt before using any external library**
- ✅ **Use file reading tools to verify existence of modules before importing**
- ✅ **When unsure about implementation details, present options rather than guessing**
- ✅ **Always preserve existing functionality when adding new features**

### 29. Issue Size Management
- ✅ **Break all issues into tasks that can be completed within a single Claude session (before context compaction)**
- ✅ **Each task should be independently testable and deployable**
- ✅ **Large features must be split into multiple smaller issues to prevent context overflow**
- ✅ **Ensure incremental progress by completing meaningful work in each session**
- ✅ **When creating issues, consider the context window limitation and plan accordingly**
- ✅ **Examples of appropriate task sizes:**
  - One endpoint with its tests and documentation
  - One service with its core functionality
  - Database migration with basic CRUD operations
  - Documentation update for a specific feature
- ✅ **If a task seems too large during implementation, stop and create sub-issues**

### 30. Maintainable Code and Architecture
- ✅ **ALWAYS design with maintainability in mind - someone else will maintain this code**
- ✅ **Avoid spaghetti code at all costs - use proper patterns and separation of concerns**
- ✅ **Design for testability - use dependency injection and avoid tight coupling**
- ✅ **Create clear interfaces between modules - minimize interdependencies**
- ✅ **Write code that is self-documenting through clear naming and structure**
- ✅ **If a solution feels hacky or complex, step back and reconsider the approach**
- ✅ **Pride in craftsmanship - write code you would be proud to show others**
- ✅ **When facing architectural decisions, always plan thoroughly before implementing**
- ✅ **Consider long-term implications of design choices, not just immediate needs**

### 31. Documentation Organization
- ✅ **All documentation must be organized in `/documentation/` subdirectories**
- ✅ **Only README.md and CLAUDE.md stay in project root**
- ✅ **Use proper subdirectories: `/api`, `/architecture`, `/database`, `/development`, `/project`, `/testing`**
- ✅ **Keep documentation close to what it describes**
- ✅ **All documentation files must be in Markdown format**
- ✅ **Update all links when moving documentation files**

### 32. Database Standards Compliance
- ✅ **ALWAYS read `documentation/database/DATABASE_STANDARDS.md` before creating any table or entity**
- ✅ **Every table MUST have: `id`, `active`, `created_at`, `updated_at`, `deleted_at`**
- ✅ **No hard deletes ever - only soft deletes with `active = false` and `deleted_at = timestamp`**
- ✅ **Use BaseEntity interface and BaseRepository<T> patterns for consistency**
- ✅ **All queries must filter by `active = true` unless specifically including deleted records**
- ✅ **Leverage TypeScript generics for reusable CRUD operations**

### 33. Professional Output Standards - No AI Tool References
- ✅ **NEVER include references to Claude, AI assistants, or any AI tools in client-facing output:**
  - Git commits and commit messages
  - Code comments and inline documentation
  - Pull request descriptions
  - Documentation files (README, guides, etc.)
  - GitHub issues and comments
  - Any deliverable that clients might see
- ✅ **Rationale: Clients pay for developer expertise and solutions, not AI usage**
- ✅ **Focus output on business value, technical implementation, and professional communication**
- ✅ **Examples of what to avoid:**
  - ❌ "Generated with Claude Code"
  - ❌ "AI-assisted implementation"
  - ❌ "Used AI to solve this"
  - ✅ Instead: "Implemented feature X using pattern Y"
- ✅ **This maintains professional image and emphasizes human expertise**

### 34. Document Learned Knowledge in Wisdom
- ✅ **When learning from external sources, create wisdom documentation**
- ✅ **External sources include: APIs, documentation, tools, debugging sessions**
- ✅ **Wisdom documents must be created in `.flowforge/documentation/wisdom/`**
- ✅ **Each document must include:**
  - Technical details and examples
  - Common issues and solutions
  - Last updated timestamp
  - Sources section with URLs
- ✅ **Categories: tools/, apis/, patterns/, debugging/**
- ✅ **This institutional knowledge travels with FlowForge to all projects**
- ✅ **Use `/update-wisdom-docs` to refresh and `/read_from_wisdom` to access**
- ✅ **The developer's skill in guiding and validating solutions is what matters**

---

## 🔄 Workflow Rules

### Universal Task Status Labels
The following status concepts must be used across all task providers:
- **ready** - Ready to be worked on
- **in progress** - Work is actively being done
- **review** - In review/testing
- **blocked** - Blocked by dependencies
- **completed** - Work finished and approved

### Starting a New Task (v2.0 Abstract System)
1. **MANDATORY**: Run `/flowforge:session:start [task-id]` - This starts timer and sets up environment
2. Verify task exists in configured task provider (GitHub, Notion, etc.)
3. Update task status to "in progress" using appropriate tools
4. Task automatically added to .flowforge/tasks.json with start time
5. Add initial comment to task explaining the implementation approach
6. Feature branch created automatically following naming convention
7. Begin implementation with active timer

### During Development
1. Write tests alongside code (Rule #3)
2. Update documentation as you go (Rule #4)
3. Commit frequently with meaningful messages
4. Reference task ID in commits
5. Keep .flowforge/tasks.json updated automatically
6. Keep task provider status current
7. **CRITICAL**: Ensure timer stays active throughout work

### Completing a Task
1. Ensure all tests pass
2. Update all relevant documentation
3. Run `/flowforge:session:end [completion-message]` to record end time
4. Update task status to "review" in task provider
5. Ask the developer for approval (per Rule #12)
6. After approval, close task and update .flowforge/tasks.json status to "completed"

---

## 🚫 Things to Avoid

1. **DON'T** start coding without a plan
2. **DON'T** skip writing tests
3. **DON'T** leave documentation outdated
4. **DON'T** work without active tasks
5. **DON'T** forget to track time - NO TIMER = NO PAY
6. **DON'T** make architectural changes without discussion
7. **DON'T** ignore established patterns
8. **DON'T** commit directly to main branch
9. **DON'T** work without running `/flowforge:session:start` first

### 35. 🚨 CRITICAL: Always Use FlowForge Agents When Available
- ✅ **MANDATORY: When a FlowForge agent exists for a task, Claude MUST use it**
- ✅ **Check available agents with Task tool before starting any work**
- ✅ **Use fft-documentation for ALL documentation tasks**
- ✅ **Use fft-testing for ALL test creation and strategy**
- ✅ **Use fft-project-manager for ALL planning and task breakdown**
- ✅ **Use fft-database for ALL database design and optimization**
- ✅ **Use fft-architecture for ALL system design decisions**
- ✅ **Use fft-api-designer for ALL API design and contracts**
- ✅ **NEVER bypass agents - they ensure consistency and quality**
- ✅ **If unsure which agent to use, check agent descriptions first**
- ✅ **This rule is UNIVERSAL and takes precedence over manual work**

### 36. 🚨 CRITICAL: TIME TRACKING IS MANDATORY - NO WORK WITHOUT ACTIVE TIMER
- ✅ **TIME = MONEY: NO TIMER = NO PAY = PROJECT FAILURE**
- ✅ **ALWAYS run `/flowforge:session:start [task-id]` before ANY work**
- ✅ **Timer MUST be running for ALL development work - no exceptions**
- ✅ **Use `/flowforge:session:pause` for breaks, `/flowforge:session:end` to complete**
- ✅ **FlowForge exists to ensure developers get paid - timer tracks billable time**
- ✅ **If timer isn't running, STOP WORK immediately and start session**
- ✅ **This is not about rules for rules' sake - it's about professional compensation**
- ✅ **Failure to track time undermines the entire purpose of FlowForge framework**

### 37. No Bugs Left Behind
- ✅ **Like the American Army motto "No man left behind", we leave NO BUGS behind**
- Every bug discovered must be fixed or documented with a clear remediation plan
- No shortcuts, no "we'll fix it later" without a tracked issue
- This applies to ALL agents and developers - bugs are mission-critical
- If you find it, you own it until it's resolved or properly handed off

### 38. Task Mirroring is Mandatory
- ✅ **ALL tasks MUST be mirrored between FlowForge JSON and user's tracking system**
- Tasks created in JSON must immediately sync to GitHub/Notion/etc
- Tasks created in external system must sync to JSON
- Single source of truth is the user's configured tracking system
- JSON is a local cache that can be regenerated from the external system
- No task exists only in one place - this causes data loss

---

## 📈 Continuous Improvement

- These rules will expand as we identify areas for improvement
- Each session should review and potentially add new rules
- Document lessons learned in retrospectives
- Share knowledge through documentation

---

## 📝 Rule Addition Template

When adding new rules, use this format:

```markdown
### [Rule Number]. [Rule Title]
- ✅ **[Rule description in bold]**
- Additional context or examples
- Rationale for the rule
```

---

**Remember**: These rules exist to help us create better software faster, with fewer mistakes and better maintainability. They are our commitment to excellence.

**Last Updated**: 2025-08-21
**Version**: 2.0.0
**Repository**: FlowForge
**Maintainer**: FlowForge Team
# Note: Task management now uses: node scripts/provider-bridge.js
