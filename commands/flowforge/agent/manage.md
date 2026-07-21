# Command: flowforge:agent:manage
# Version: 2.0.0
# Description: FlowForge agent manage command

---
description: Manage FlowForge custom agents - list, install, and configure specialized AI assistants
argument-hint: "[list|install|remove|info] [agent-name]"
---

# /ffa - FlowForge Agent Manager

Manage custom AI agents for specialized tasks. Agents are focused AI assistants with specific expertise.

## Usage

```bash
/ffa                    # Interactive mode - list and select agents
/ffa list              # List all available agents
/ffa install <name>    # Install specific agent to project
/ffa remove <name>     # Remove installed agent
/ffa info <name>       # Show detailed agent information
```

## Examples

```bash
/ffa                           # Show interactive agent selector
/ffa list                      # See all FlowForge agents
/ffa install fft-devops-agent  # Install the DevOps specialist
/ffa info fft-devops-agent     # View agent details
/ffa remove fft-devops-agent   # Remove from project
```

## Available Agents

Agents provide specialized expertise:
- `fft-devops-agent` - DevOps, ML/AI tools, Docker, Kubernetes expert
- More agents coming soon...

## How It Works

1. Agents are stored in `.flowforge/agents/` as YAML configurations
2. Installing copies them to `.claude/agents/` in your project
3. Claude can then invoke them using the Task tool
4. Each agent has focused knowledge and limited tools

## Creating Custom Agents

Create new agents by adding YAML files to `.flowforge/agents/`:

```yaml
name: my-agent
description: Brief description
system_prompt: |
  Detailed instructions...
tools:
  - Read
  - Write
```

## Interactive Mode

When run without arguments, `/ffa` shows an interactive menu:
- ✓ marks installed agents
- ○ marks available agents
- Select agents to install/remove
- View detailed information

## Agent Invocation

Once installed, Claude can use agents:
```python
Task(
    description="Setup Docker",
    prompt="Configure Docker for GPU ML workloads",
    subagent_type="fft-devops-agent"
)
```