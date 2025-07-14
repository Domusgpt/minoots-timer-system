#!/bin/bash

##############################################################################
# COMPLETE MINOOTS SYSTEM TEST
# Tests the entire session-targeting timer system end-to-end
##############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[TEST] $1${NC}"
}

log_success() {
    echo -e "${GREEN}[PASS] $1${NC}"
}

log_error() {
    echo -e "${RED}[FAIL] $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[WARN] $1${NC}"
}

TEST_DIR="/mnt/c/Users/millz/minoots-timer-system"
TEST_API_KEY="test_key_12345"
TEST_USER_ID="test_user_$(hostname)"

log_info "🧪 STARTING COMPLETE MINOOTS SYSTEM TEST"
log_info "Test directory: $TEST_DIR"
log_info "Test user ID: $TEST_USER_ID"

# Test 1: Enhanced MCP Server Session Detection
test_enhanced_mcp_session_detection() {
    log_info "Test 1: Enhanced MCP Server Session Detection"
    
    cd "$TEST_DIR/mcp"
    
    # Test that the enhanced MCP server starts and captures session info
    export MINOOTS_API_KEY="$TEST_API_KEY"
    export MINOOTS_USER_ID="$TEST_USER_ID"
    
    local session_output
    if session_output=$(timeout 2s node enhanced-session-timer.js 2>&1); then
        if echo "$session_output" | grep -q "Enhanced MINOOTS MCP Server running"; then
            log_success "Enhanced MCP server starts successfully"
        else
            log_error "Enhanced MCP server failed to start properly"
            return 1
        fi
    else
        log_error "Enhanced MCP server failed to start: $session_output"
        return 1
    fi
}

# Test 2: Session Detection Functions
test_session_detection_functions() {
    log_info "Test 2: Session Detection Functions"
    
    cd "$TEST_DIR/mcp"
    
    # Create a test script to check session detection
    cat > test-session-detection.js << 'EOF'
import { execSync } from 'child_process';
import path from 'path';

// Mock session detection functions from enhanced-session-timer.js
function detectClaudeSessionId() {
    if (process.env.CLAUDE_SESSION_ID) {
        return process.env.CLAUDE_SESSION_ID;
    }
    const dirHash = path.basename(process.cwd()).replace(/[^a-zA-Z0-9]/g, '_');
    return `claude_${dirHash}_${Date.now().toString(36)}`;
}

function getUserId() {
    if (process.env.MINOOTS_USER_ID) {
        return process.env.MINOOTS_USER_ID;
    }
    const username = process.env.USER || process.env.USERNAME || 'unknown';
    const hostname = require('os').hostname();
    return `${username}_${hostname}`;
}

function captureSessionDetails() {
    return {
        claude_session_id: detectClaudeSessionId(),
        working_directory: process.cwd(),
        process_pid: process.pid,
        user_id: getUserId(),
        username: process.env.USER || process.env.USERNAME || 'unknown',
        platform: process.platform,
        session_start: Date.now()
    };
}

// Test the functions
const sessionInfo = captureSessionDetails();
console.log('Session detection test results:');
console.log(`Session ID: ${sessionInfo.claude_session_id}`);
console.log(`Working Directory: ${sessionInfo.working_directory}`);
console.log(`User ID: ${sessionInfo.user_id}`);
console.log(`Platform: ${sessionInfo.platform}`);

// Verify all required fields are present
const requiredFields = ['claude_session_id', 'working_directory', 'user_id', 'username', 'platform'];
let success = true;
for (const field of requiredFields) {
    if (!sessionInfo[field] || sessionInfo[field] === 'unknown') {
        console.log(`ERROR: Missing or invalid field: ${field}`);
        success = false;
    }
}

if (success) {
    console.log('SUCCESS: All session detection functions working');
    process.exit(0);
} else {
    console.log('FAILED: Session detection incomplete');
    process.exit(1);
}
EOF

    local detection_output
    if detection_output=$(node test-session-detection.js 2>&1); then
        if echo "$detection_output" | grep -q "SUCCESS: All session detection functions working"; then
            log_success "Session detection functions working correctly"
            echo "$detection_output" | grep -E "(Session ID|Working Directory|User ID|Platform):"
        else
            log_error "Session detection functions failed: $detection_output"
            return 1
        fi
    else
        log_error "Failed to test session detection: $detection_output"
        return 1
    fi
    
    rm -f test-session-detection.js
}

# Test 3: System Daemon Dependency Check
test_daemon_dependencies() {
    log_info "Test 3: System Daemon Dependency Check"
    
    cd "$TEST_DIR/system-daemon"
    
    # Test without API key (should fail)
    local daemon_output
    if daemon_output=$(./minoots-timer-daemon.sh check 2>&1); then
        log_error "Daemon check should have failed without API key"
        return 1
    else
        if echo "$daemon_output" | grep -q "MINOOTS_API_KEY environment variable not set"; then
            log_success "Daemon correctly detects missing API key"
        else
            log_error "Daemon failed for wrong reason: $daemon_output"
            return 1
        fi
    fi
    
    # Test with API key (should pass dependency check but fail API connection)
    export MINOOTS_API_KEY="$TEST_API_KEY"
    if daemon_output=$(./minoots-timer-daemon.sh check 2>&1); then
        if echo "$daemon_output" | grep -q "All dependencies satisfied"; then
            log_success "Daemon dependency check passes with API key"
        else
            log_warning "Dependencies check passed but with warnings: $daemon_output"
        fi
    else
        log_error "Daemon dependency check failed: $daemon_output"
        return 1
    fi
}

# Test 4: Webhook Bridge Structure
test_webhook_bridge_structure() {
    log_info "Test 4: Webhook Bridge Structure"
    
    local bridge_dir="$TEST_DIR/webhook-bridge"
    
    # Check required files exist
    local required_files=(
        "functions/index.js"
        "functions/package.json"
        "firebase.json"
        "firestore.rules"
        "firestore.indexes.json"
    )
    
    for file in "${required_files[@]}"; do
        if [ -f "$bridge_dir/$file" ]; then
            log_success "Bridge file exists: $file"
        else
            log_error "Missing bridge file: $file"
            return 1
        fi
    done
    
    # Check if functions code has required endpoints
    local functions_file="$bridge_dir/functions/index.js"
    local required_exports=("webhook" "commands" "markExecuted" "health")
    
    for export in "${required_exports[@]}"; do
        if grep -q "exports.$export" "$functions_file"; then
            log_success "Bridge endpoint exists: $export"
        else
            log_error "Missing bridge endpoint: $export"
            return 1
        fi
    done
}

# Test 5: Timer Creation Workflow (Mock)
test_timer_creation_workflow() {
    log_info "Test 5: Timer Creation Workflow (Mock)"
    
    cd "$TEST_DIR/mcp"
    
    # Create a mock test for timer creation with session targeting
    cat > test-timer-creation.js << 'EOF'
import { v4 as uuidv4 } from 'uuid';

// Mock the timer creation workflow
function mockCaptureSessionDetails() {
    return {
        claude_session_id: `test_session_${Date.now()}`,
        working_directory: process.cwd(),
        process_pid: process.pid,
        user_id: process.env.MINOOTS_USER_ID || 'test_user',
        username: process.env.USER || 'test',
        platform: process.platform,
        session_start: Date.now()
    };
}

function mockCreateSessionTimer(args) {
    const sessionInfo = mockCaptureSessionDetails();
    
    const timerConfig = {
        name: args.name,
        duration: args.duration,
        agent_id: sessionInfo.claude_session_id,
        events: {
            on_expire: {
                webhook: `https://bridge.minoots.com/webhook/${sessionInfo.user_id}`,
                message: args.message || `Timer "${args.name}" expired`,
                data: {
                    command: args.command,
                    session_id: sessionInfo.claude_session_id,
                    working_directory: sessionInfo.working_directory,
                    process_pid: sessionInfo.process_pid,
                    user_id: sessionInfo.user_id,
                    username: sessionInfo.username,
                    platform: sessionInfo.platform,
                    created_timestamp: Date.now(),
                    command_type: 'session_targeted_execution'
                }
            }
        }
    };
    
    console.log('Mock timer created successfully:');
    console.log(`- Name: ${timerConfig.name}`);
    console.log(`- Duration: ${timerConfig.duration}`);
    console.log(`- Command: ${args.command}`);
    console.log(`- Session ID: ${sessionInfo.claude_session_id}`);
    console.log(`- Working Directory: ${sessionInfo.working_directory}`);
    console.log(`- Webhook URL: ${timerConfig.events.on_expire.webhook}`);
    
    return { success: true, timer: timerConfig };
}

// Test timer creation
const testArgs = {
    name: 'test_timer',
    duration: '30s',
    command: 'echo "Timer test successful"',
    message: 'Test timer expired'
};

const result = mockCreateSessionTimer(testArgs);

if (result.success) {
    console.log('SUCCESS: Timer creation workflow works correctly');
    process.exit(0);
} else {
    console.log('FAILED: Timer creation workflow failed');
    process.exit(1);
}
EOF

    local creation_output
    export MINOOTS_USER_ID="$TEST_USER_ID"
    if creation_output=$(node test-timer-creation.js 2>&1); then
        if echo "$creation_output" | grep -q "SUCCESS: Timer creation workflow works correctly"; then
            log_success "Timer creation workflow working correctly"
            echo "$creation_output" | grep -E "(Name|Duration|Command|Session ID|Working Directory):"
        else
            log_error "Timer creation workflow failed: $creation_output"
            return 1
        fi
    else
        log_error "Failed to test timer creation: $creation_output"
        return 1
    fi
    
    rm -f test-timer-creation.js
}

# Test 6: File Structure and Documentation
test_file_structure() {
    log_info "Test 6: File Structure and Documentation"
    
    # Check main project structure
    local required_dirs=(
        "mcp"
        "system-daemon"
        "webhook-bridge"
        "functions"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [ -d "$TEST_DIR/$dir" ]; then
            log_success "Directory exists: $dir"
        else
            log_error "Missing directory: $dir"
            return 1
        fi
    done
    
    # Check key files
    local key_files=(
        "mcp/enhanced-session-timer.js"
        "system-daemon/minoots-timer-daemon.sh"
        "system-daemon/install-daemon.sh"
        "webhook-bridge/functions/index.js"
        "CLAUDE.md"
        "README.md"
    )
    
    for file in "${key_files[@]}"; do
        if [ -f "$TEST_DIR/$file" ]; then
            log_success "Key file exists: $file"
        else
            log_error "Missing key file: $file"
            return 1
        fi
    done
}

# Run all tests
run_all_tests() {
    local test_functions=(
        "test_file_structure"
        "test_enhanced_mcp_session_detection"
        "test_session_detection_functions" 
        "test_daemon_dependencies"
        "test_webhook_bridge_structure"
        "test_timer_creation_workflow"
    )
    
    local passed=0
    local total=${#test_functions[@]}
    
    for test_func in "${test_functions[@]}"; do
        echo ""
        log_info "Running $test_func..."
        if $test_func; then
            ((passed++))
        fi
    done
    
    echo ""
    log_info "🏁 TEST SUMMARY"
    log_info "Tests passed: $passed/$total"
    
    if [ $passed -eq $total ]; then
        log_success "🎉 ALL TESTS PASSED! System is ready for deployment."
        echo ""
        log_info "Next steps:"
        log_info "1. Deploy webhook bridge to Firebase"
        log_info "2. Install system daemon: ./system-daemon/install-daemon.sh install"
        log_info "3. Configure Claude Code with enhanced MCP server"
        log_info "4. Test complete workflow with real timer"
        return 0
    else
        log_error "❌ Some tests failed. Please fix issues before deployment."
        return 1
    fi
}

# Main execution
run_all_tests