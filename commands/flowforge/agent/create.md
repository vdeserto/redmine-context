# Command: flowforge:agent:create
# Version: 2.0.0
# Description: FlowForge agent create command

---
description: Interactive wizard to create custom FlowForge agents with intelligent rule selection
argument-hint: "[agent-type]"
---

# /create-agent - FlowForge Agent Creation Wizard

Create professional AI agents with guided configuration and automatic FlowForge rule integration.

## Usage

```bash
/create-agent              # Interactive mode
/create-agent code-review  # Start with specific type
/create-agent dba         # Database specialist
```

## Agent Types

- `code-review` - Code quality and standards enforcement
- `dba` - Database design and optimization
- `frontend` - UI/UX and frontend frameworks
- `backend` - API and server-side logic
- `devops` - Infrastructure and deployment
- `testing` - Test creation and quality assurance
- `documentation` - Technical writing and docs
- `security` - Security analysis and compliance
- `custom` - Build from scratch

## Interactive Process

The wizard will guide you through:
1. Agent type selection
2. Specialization questions
3. Tool requirements
4. Behavior configuration
5. FlowForge rules selection
6. Customization (name, color, icon)

## Example Session

```
🧙 FlowForge Agent Creation Wizard
────────────────────────────────

What type of agent would you like to create?
> dba

Great! Let's create a Database Specialist agent.

Which databases should this agent specialize in?
[x] PostgreSQL
[x] MySQL
[ ] MongoDB
[x] Redis

What should be the agent's primary focus?
> Schema design and optimization

Should this agent work proactively? (y/n)
> y

Select a color for your agent:
> 💚 green

Agent created: fft-db-optimizer
```

## Features

- **Intelligent Questions**: Context-aware based on agent type
- **Rule Integration**: Automatically selects relevant FlowForge rules
- **Best Practices**: Includes patterns and standards
- **Customizable**: Name, color, icon, and behavior
- **Ready to Use**: Generates complete agent configuration

## Benefits

- Consistent agent quality
- No need to write prompts from scratch
- Learns from existing successful agents
- Enforces FlowForge standards
- Educational about best practices