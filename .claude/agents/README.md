# FlowForge Agents

## Overview

FlowForge Agents are pre-built, professional AI subagents that integrate seamlessly with Claude Code's native agent system. They provide specialized expertise for common development tasks, tested and refined by the FlowForge community.

## How It Works

FlowForge leverages Anthropic's native agent system by providing:

1. **Curated Agent Library**: Professional agents ready to use
2. **Easy Installation**: Simple command to add agents to your project
3. **Native Integration**: Works with Claude's `/agents` command
4. **Automatic Updates**: Get improved agents with FlowForge updates

### The Integration

```
FlowForge Agents (.flowforge/agents/)
    ↓
/flowforge:agent:manage install <agent-name>
    ↓
Copies to .claude/agents/
    ↓
Available in Claude's native system
    ↓
Use via /agents or automatic delegation
```

## Available Agents

### fft-devops-agent
- **Description**: DevOps specialist for ML/AI tools, Docker, Kubernetes, and Linux environments
- **Author**: Alexandre Cruz
- **Version**: 1.0.0
- **Specialties**: 
  - ML/AI infrastructure setup (Llama, Whisper, PyTorch, etc.)
  - Docker and Kubernetes configuration
  - Linux system administration (especially Arch Linux)
  - Development environment optimization
  - CI/CD pipeline setup

### fft-code-reviewer
- **Description**: Expert code review specialist for Python, JavaScript, Ruby, CSS, and HTML
- **Author**: Alexandre Cruz
- **Version**: 1.0.0
- **Specialties**:
  - Enforces FlowForge standards (testing, documentation, file limits)
  - Multi-language expertise (Python, JS/TS, Ruby, CSS, HTML)
  - SOLID principles and design patterns
  - Security vulnerability detection
  - Code smell identification
- **Usage**: Proactive for all PR reviews and code quality analysis

## Installation & Usage

### Installing FlowForge Agents

```bash
# Browse available agents
/flowforge:agent:manage

# Install specific agent
/flowforge:agent:manage install fft-devops-agent

# View agent details
/flowforge:agent:manage info fft-devops-agent
```

### Using Installed Agents

Once installed, agents work with Claude's native system:

1. **Automatic**: Claude delegates appropriate tasks automatically
2. **Explicit**: "Use fft-devops-agent to setup Docker for ML"
3. **Management**: Use `/agents` to view, edit, or remove

### Agent File Format

FlowForge agents follow Anthropic's standard format:

```markdown
---
name: agent-name
description: When this agent should be used
tools: Bash, Read, Write, Edit  # Optional, inherits all if omitted
---

System prompt defining the agent's expertise and behavior...
```

## Creating FlowForge Agents

### Method 1: Using the Agent Creation Wizard

FlowForge includes an interactive wizard for creating agents:

```bash
# Run the wizard (FlowForge command)
/flowforge:agent:create

# Or use the script directly
.flowforge/scripts/create-agent.sh

# For a simplified version
.flowforge/scripts/create-agent-simple.sh
```

The wizard will guide you through:
- Selecting agent type and specialization
- Defining the agent's mission
- Choosing tools and FlowForge rules
- Customizing name and appearance

### Method 2: Manual Creation

1. **Create Agent File**: Add `.md` file to this directory
2. **Follow Format**: Use Anthropic's agent format
3. **Test Locally**: Install and test in a project
4. **Document**: Include clear description and examples
5. **Submit PR**: Share with the FlowForge community

### Agent Guidelines

- **Single Purpose**: Each agent should excel at one thing
- **Clear Description**: Help Claude know when to use it
- **Appropriate Tools**: Only request necessary tools
- **Professional Prompt**: Well-structured, clear instructions
- **Output Format**: Consistent, professional results

## Integration with Claude Code

FlowForge agents are fully compatible with Claude Code's features:

- **Task Tool**: Can be invoked via `Task(subagent_type="agent-name", ...)`
- **Agent Chaining**: Agents can invoke other agents
- **Tool Restrictions**: Respect tool access limitations
- **Context Isolation**: Each agent has its own context

## Benefits of FlowForge Agents

1. **Professional Quality**: Tested and refined by experts
2. **Consistent Standards**: All agents follow FlowForge best practices
3. **Time Saving**: No need to create common agents from scratch
4. **Team Alignment**: Everyone uses the same high-quality agents
5. **Regular Updates**: Improvements delivered via FlowForge updates

## FAQ

### Q: How do FlowForge agents differ from custom agents?
A: FlowForge agents ARE custom agents, just pre-built and tested. They use the exact same system as agents you create with `/agents`.

### Q: Can I modify FlowForge agents?
A: Yes! Once installed, you can edit them using `/agents` or by modifying the files in `.claude/agents/`.

### Q: Do agents update automatically?
A: Agents in `.flowforge/agents/` update with FlowForge. Installed agents in `.claude/agents/` remain unchanged unless you reinstall them.

### Q: Can I use FlowForge agents without FlowForge?
A: Yes! Once installed to `.claude/agents/`, they work independently of FlowForge.

## Roadmap

### Completed
- ✅ Code Review Agent (fft-code-reviewer)
- ✅ DevOps Agent (fft-devops-agent)
- ✅ Agent Creation Wizard (/create-agent)

### Planned Agents
1. **Database Specialist**: Schema design, query optimization
2. **API Designer**: RESTful/GraphQL API design
3. **Security Auditor**: Vulnerability scanning, compliance
4. **Performance Optimizer**: Code and system optimization
5. **Documentation Writer**: Technical documentation expert

### Platform Features
1. **Agent Marketplace**: Browse and rate community agents
2. **Agent Templates**: Starter templates for common patterns
3. **Version Management**: Track and update agent versions
4. **Performance Metrics**: See how agents improve productivity
5. **Agent Composition**: Chain multiple agents for complex tasks

## Contributing

We welcome agent contributions! Great agents:
- Solve real problems developers face
- Have clear, focused expertise
- Include comprehensive prompts
- Follow FlowForge quality standards

Submit your agents via PR to the FlowForge repository.