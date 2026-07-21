---
description: Complete FlowForge setup after installation
argument-hint: none
---

# 🚀 FlowForge Setup Helper

Complete your FlowForge installation with proper branch setup!

## 📋 Post-Installation Steps

### 1. Create a GitHub Issue
```bash
# Create issue for FlowForge integration
gh issue create \
  --title "Integrate FlowForge developer productivity framework" \
  --body "## Description
Integrate FlowForge to improve development workflow.

## Tasks
- [x] Add FlowForge as submodule
- [x] Run installer
- [ ] Test all features
- [ ] Update team documentation

## Benefits
- Automated rule enforcement
- Time tracking with documentation updates
- TDD workflow support
- Professional standards" \
  --label "enhancement,tooling"
```

### 2. Note the Issue Number
The command above will output an issue number (e.g., #1).

### 3. Create Proper Branch
```bash
# Replace XX with your issue number
git checkout -b feature/XX-flowforge-integration
```

### 4. Commit FlowForge
```bash
# Now you can commit normally
git add .
git commit -m "feat: integrate FlowForge developer productivity framework

- Added FlowForge with automated rule enforcement
- Configured time tracking and documentation updates
- Set up TDD workflow and git hooks
- Added Claude Code productivity commands"
```

### 5. Push and Create PR
```bash
# Push your branch
git push -u origin feature/XX-flowforge-integration

# Create pull request
gh pr create --fill
```

## 🎯 What FlowForge Provides

✅ **Git Hooks**
- Pre-commit: Enforces all 33 rules
- Commit-msg: Validates format and no AI references
- Pre-push: Final quality checks

✅ **Time Tracking**
- `./scripts/task-time.sh start XX`
- Automatic documentation updates
- Session history tracking

✅ **Claude Commands**
- `/startsession XX` - Start work with setup
- `/callthenight` - End day with full automation
- `/tdd feature` - Test-driven development
- `/plan feature` - Plan from roadmap
- `/addrule` - Add custom rules

✅ **Documentation**
- Self-updating task tracking via JSON provider
- Automatic progress tracking in .flowforge/tasks.json
- Session logs in .flowforge/sessions/

## 💡 Tips

1. **Always work on feature branches** with issue numbers
2. **Start sessions** with `/startsession XX`
3. **End days** with `/callthenight`
4. **Write tests first** with `/tdd`
5. **Plan features** with `/plan`

Welcome to automated productivity! 🔥