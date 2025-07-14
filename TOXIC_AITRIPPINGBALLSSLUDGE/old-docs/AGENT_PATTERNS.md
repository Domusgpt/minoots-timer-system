# 🤖 AI AGENT COORDINATION PATTERNS

**Common patterns for AI agents using MINOOTS timer infrastructure.**

## 🔄 RATE LIMIT COORDINATION

### Pattern: API Rate Limit Recovery
```javascript
// When hitting rate limits, create recovery timer
const rateLimitRecovery = async (service, resetTime) => {
  const waitDuration = Math.ceil((resetTime - Date.now()) / 1000);
  
  await minoots.timers.create({
    name: `${service} Rate Limit Reset`,
    duration: `${waitDuration}s`,
    events: {
      on_expire: {
        webhook: 'https://your-agent.com/resume-operations',
        data: { service, action: 'resume_api_calls' }
      }
    }
  });
};

// Usage
if (response.status === 429) {
  const resetTime = response.headers['x-ratelimit-reset'];
  await rateLimitRecovery('github-api', resetTime * 1000);
}
```

## 🎯 LONG-RUNNING PROCESS MONITORING

### Pattern: AI Training Job Timeout
```javascript
// Monitor ML training with automatic termination
const monitorTrainingJob = async (jobId, maxDuration = '6h') => {
  const timeoutTimer = await minoots.timers.create({
    name: `Training Timeout: ${jobId}`,
    duration: maxDuration,
    events: {
      on_expire: {
        webhook: 'https://ml-ops.com/training-timeout',
        data: { jobId, action: 'terminate_job' }
      }
    }
  });
  
  // Progress monitoring
  const progressTimer = await minoots.timers.create({
    name: `Training Progress: ${jobId}`,
    duration: maxDuration,
    events: {
      on_progress: {
        webhook: 'https://ml-ops.com/training-progress',
        intervals: ['25%', '50%', '75%']
      }
    }
  });
  
  return { timeoutTimer, progressTimer };
};
```

## 🔀 MULTI-AGENT COORDINATION

### Pattern: Parallel Agent Tasks
```javascript
// Coordinate multiple agents on parallel tasks
const coordinateAgents = async (tasks) => {
  const timers = [];
  
  for (const task of tasks) {
    const timer = await minoots.timers.create({
      name: `Agent Task: ${task.name}`,
      duration: task.maxDuration,
      events: {
        on_expire: {
          webhook: 'https://coordinator.com/task-timeout',
          data: {
            taskId: task.id,
            agentId: task.agent,
            action: 'force_completion'
          }
        }
      }
    });
    timers.push({ task, timer });
  }
  
  return timers;
};
```

## 🎪 WORKFLOW ORCHESTRATION

### Pattern: Sequential Agent Handoffs
```javascript
// Chain agents with timer-based handoffs
const agentWorkflow = async (workflow) => {
  let currentTimer = null;
  
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const nextStep = workflow.steps[i + 1];
    
    currentTimer = await minoots.timers.create({
      name: `Workflow: ${step.name}`,
      duration: step.timeout,
      events: {
        on_expire: {
          webhook: nextStep 
            ? `https://agents.com/${nextStep.agent}/start`
            : 'https://workflow.com/complete',
          data: {
            workflowId: workflow.id,
            step: i,
            handoff: nextStep?.agent
          }
        }
      }
    });
  }
  
  return currentTimer;
};
```

## 🧠 MEMORY & STATE MANAGEMENT

### Pattern: Agent Memory Refresh
```javascript
// Periodic memory cleanup for long-running agents
const scheduleMemoryRefresh = async (agentId, interval = '1h') => {
  return await minoots.timers.create({
    name: `Memory Refresh: ${agentId}`,
    duration: interval,
    events: {
      on_expire: {
        webhook: `https://agents.com/${agentId}/refresh-memory`,
        data: { agentId, action: 'clear_temporary_state' }
      }
    }
  });
};
```

## 🚨 ERROR RECOVERY

### Pattern: Circuit Breaker Reset
```javascript
// Reset circuit breaker after failure period
const scheduleCircuitBreakerReset = async (service, backoffTime = '5m') => {
  return await minoots.timers.create({
    name: `Circuit Breaker Reset: ${service}`,
    duration: backoffTime,
    events: {
      on_expire: {
        webhook: `https://services.com/${service}/reset-circuit-breaker`,
        data: { service, action: 'attempt_reconnect' }
      }
    }
  });
};
```

## 📅 SCHEDULED AGENT TASKS

### Pattern: Daily Agent Routines
```javascript
// Schedule recurring agent tasks
const scheduleAgentRoutine = async (agentId, routine) => {
  return await minoots.timers.create({
    name: `Daily Routine: ${agentId}`,
    duration: '24h',
    events: {
      on_expire: {
        webhook: `https://agents.com/${agentId}/daily-routine`,
        data: { 
          agentId, 
          routine,
          nextSchedule: Date.now() + (24 * 60 * 60 * 1000)
        }
      }
    }
  });
};
```

## 🎮 GAME THEORY PATTERNS

### Pattern: Competitive Agent Timeouts
```javascript
// Multiple agents competing with time limits
const startAgentCompetition = async (agents, timeLimit = '30m') => {
  const timers = await Promise.all(
    agents.map(agent => 
      minoots.timers.create({
        name: `Competition: ${agent.id}`,
        duration: timeLimit,
        events: {
          on_expire: {
            webhook: 'https://competition.com/timeout',
            data: { 
              agentId: agent.id,
              action: 'submit_current_result'
            }
          }
        }
      })
    )
  );
  
  return timers;
};
```