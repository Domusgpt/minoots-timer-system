#!/bin/bash

##############################################################################
# MINOOTS TIMER COMMAND DAEMON
# 
# Monitors webhook bridge for expired timer commands and executes them
# in the correct Claude Code sessions with perfect targeting
##############################################################################

set -euo pipefail

# Configuration
DAEMON_NAME="minoots-timer-daemon"
USER_ID="${MINOOTS_USER_ID:-$(whoami)_$(hostname)}"
COMMANDS_URL="${MINOOTS_COMMANDS_URL:-https://commands-bwffy2zraq-uc.a.run.app}"
MARK_EXECUTED_URL="${MINOOTS_MARK_EXECUTED_URL:-https://markexecuted-bwffy2zraq-uc.a.run.app}"
API_KEY="${MINOOTS_API_KEY:-}"
CHECK_INTERVAL="${MINOOTS_CHECK_INTERVAL:-30}"
LOG_FILE="/tmp/${DAEMON_NAME}.log"
PID_FILE="/tmp/${DAEMON_NAME}.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_message() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[$timestamp] $1"
    echo -e "$message" | tee -a "$LOG_FILE"
}

log_error() {
    log_message "${RED}ERROR: $1${NC}"
}

log_success() {
    log_message "${GREEN}SUCCESS: $1${NC}"
}

log_info() {
    log_message "${BLUE}INFO: $1${NC}"
}

log_warning() {
    log_message "${YELLOW}WARNING: $1${NC}"
}

check_dependencies() {
    log_info "Checking dependencies..."
    
    # Check for Claude Code
    if ! command -v claude >/dev/null 2>&1; then
        log_error "Claude Code CLI not found. Please install Claude Code."
        exit 1
    fi
    
    # Check for curl
    if ! command -v curl >/dev/null 2>&1; then
        log_error "curl not found. Please install curl."
        exit 1
    fi
    
    # Check for jq
    if ! command -v jq >/dev/null 2>&1; then
        log_error "jq not found. Please install jq for JSON processing."
        exit 1
    fi
    
    # Check API key
    if [ -z "$API_KEY" ]; then
        log_error "MINOOTS_API_KEY environment variable not set"
        exit 1
    fi
    
    log_success "All dependencies satisfied"
}

execute_timer_command() {
    local command="$1"
    local session_id="$2" 
    local working_dir="$3"
    local timer_name="$4"
    local command_id="$5"
    local username="$6"
    
    log_info "🔥 EXECUTING TIMER COMMAND"
    log_info "📝 Command: $command"
    log_info "📍 Target Session: $session_id"
    log_info "📂 Target Directory: $working_dir"
    log_info "👤 User: $username"
    log_info "⏰ Timer: $timer_name"
    
    local execution_success=false
    local execution_output=""
    
    # METHOD 1: Try to resume original Claude session
    if [ ! -z "$session_id" ] && [ "$session_id" != "null" ]; then
        log_info "🎯 Attempting to resume Claude session: $session_id"
        
        # Change to target directory
        if [ -d "$working_dir" ]; then
            cd "$working_dir"
            log_info "📂 Changed to directory: $(pwd)"
        else
            log_warning "Directory $working_dir does not exist, using current directory"
        fi
        
        # Try to resume Claude session and execute command
        local resume_output
        if resume_output=$(claude --resume "$session_id" --print "Timer '$timer_name' expired! Executing: $command" 2>&1); then
            log_success "✅ Command executed successfully in original Claude session"
            execution_success=true
            execution_output="$resume_output"
        else
            log_warning "⚠️ Failed to resume Claude session: $resume_output"
        fi
    fi
    
    # METHOD 2: Start new Claude session in correct directory (if resume failed)
    if [ "$execution_success" = false ]; then
        log_info "🚀 Starting new Claude session in $working_dir"
        
        if [ -d "$working_dir" ]; then
            cd "$working_dir"
        fi
        
        local new_session_output
        if new_session_output=$(claude --print "Timer '$timer_name' expired! Executing command: $command" 2>&1); then
            log_success "✅ Command executed in new Claude session"
            execution_success=true
            execution_output="$new_session_output"
        else
            log_warning "⚠️ Failed to start new Claude session: $new_session_output"
        fi
    fi
    
    # METHOD 3: Direct command execution (fallback)
    if [ "$execution_success" = false ]; then
        log_info "⚡ Direct execution fallback"
        
        if [ -d "$working_dir" ]; then
            cd "$working_dir"
        fi
        
        local direct_output
        if direct_output=$(eval "$command" 2>&1); then
            log_success "✅ Command executed directly"
            execution_success=true
            execution_output="$direct_output"
        else
            log_error "❌ All execution methods failed: $direct_output"
            execution_output="Failed: $direct_output"
        fi
    fi
    
    # Log execution result
    log_info "📄 Execution output:"
    echo "$execution_output" | tee -a "$LOG_FILE"
    
    # Mark command as executed in bridge
    mark_command_executed "$command_id" "$execution_success" "$execution_output"
    
    return 0
}

mark_command_executed() {
    local command_id="$1"
    local success="$2"
    local output="$3"
    
    log_info "📝 Marking command $command_id as executed (success: $success)"
    
    local mark_response
    mark_response=$(curl -s -X POST "$MARK_EXECUTED_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"$USER_ID\",
            \"commandId\": \"$command_id\",
            \"result\": {
                \"success\": $success,
                \"output\": \"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"
            }
        }" 2>&1)
    
    if echo "$mark_response" | jq -e '.success' >/dev/null 2>&1; then
        log_success "✅ Command marked as executed in bridge"
    else
        log_warning "⚠️ Failed to mark command as executed: $mark_response"
    fi
}

monitor_timer_commands() {
    log_info "🔍 Starting command monitoring loop"
    log_info "👤 User ID: $USER_ID"
    log_info "🌐 Commands URL: $COMMANDS_URL"
    log_info "🌐 Mark Executed URL: $MARK_EXECUTED_URL"
    log_info "⏱️ Check interval: $CHECK_INTERVAL seconds"
    
    while true; do
        # Check for pending timer commands
        local response
        response=$(curl -s "$COMMANDS_URL/$USER_ID" 2>/dev/null || echo "[]")
        
        # Validate response
        if echo "$response" | jq empty >/dev/null 2>&1; then
            local command_count
            command_count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
            
            if [ "$command_count" -gt 0 ]; then
                log_info "📨 Found $command_count pending timer command(s)"
                
                # Process each command
                echo "$response" | jq -c '.[]' 2>/dev/null | while read -r cmd; do
                    local command=$(echo "$cmd" | jq -r '.command // "unknown"')
                    local session_id=$(echo "$cmd" | jq -r '.session_id // ""')
                    local working_dir=$(echo "$cmd" | jq -r '.working_directory // "."')
                    local timer_name=$(echo "$cmd" | jq -r '.timer_name // "Unknown Timer"')
                    local command_id=$(echo "$cmd" | jq -r '.id // ""')
                    local username=$(echo "$cmd" | jq -r '.username // "unknown"')
                    
                    # Execute the command
                    execute_timer_command "$command" "$session_id" "$working_dir" "$timer_name" "$command_id" "$username"
                done
            fi
        else
            log_warning "⚠️ Invalid response from bridge API: $response"
        fi
        
        # Wait before next check
        sleep "$CHECK_INTERVAL"
    done
}

start_daemon() {
    # Check if daemon is already running
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if ps -p "$old_pid" > /dev/null 2>&1; then
            log_warning "Daemon already running with PID $old_pid"
            exit 1
        else
            log_info "Removing stale PID file"
            rm -f "$PID_FILE"
        fi
    fi
    
    # Write PID file
    echo $$ > "$PID_FILE"
    
    # Set up signal handlers
    trap 'log_info "Received SIGTERM, shutting down..."; cleanup_and_exit' TERM
    trap 'log_info "Received SIGINT, shutting down..."; cleanup_and_exit' INT
    
    log_success "🚀 MINOOTS Timer Daemon started (PID: $$)"
    log_info "📁 Log file: $LOG_FILE"
    log_info "📁 PID file: $PID_FILE"
    
    # Start monitoring
    monitor_timer_commands
}

cleanup_and_exit() {
    log_info "🛑 Shutting down daemon..."
    rm -f "$PID_FILE"
    log_success "👋 Daemon stopped cleanly"
    exit 0
}

stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log_info "Stopping daemon (PID: $pid)"
            kill -TERM "$pid"
            sleep 2
            if ps -p "$pid" > /dev/null 2>&1; then
                log_warning "Daemon still running, force killing..."
                kill -KILL "$pid"
            fi
            rm -f "$PID_FILE"
            log_success "Daemon stopped"
        else
            log_warning "Daemon not running (stale PID file)"
            rm -f "$PID_FILE"
        fi
    else
        log_warning "Daemon not running (no PID file)"
    fi
}

status_daemon() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log_success "Daemon running (PID: $pid)"
            return 0
        else
            log_error "Daemon not running (stale PID file)"
            return 1
        fi
    else
        log_error "Daemon not running"
        return 1
    fi
}

show_help() {
    echo "MINOOTS Timer Command Daemon"
    echo "Usage: $0 {start|stop|restart|status|check|help}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the daemon"
    echo "  stop     - Stop the daemon" 
    echo "  restart  - Restart the daemon"
    echo "  status   - Check daemon status"
    echo "  check    - Check dependencies and configuration"
    echo "  help     - Show this help"
    echo ""
    echo "Environment Variables:"
    echo "  MINOOTS_USER_ID           - User identifier (default: \$(whoami)_\$(hostname))"
    echo "  MINOOTS_COMMANDS_URL      - Commands polling URL (default: https://commands-bwffy2zraq-uc.a.run.app)"
    echo "  MINOOTS_MARK_EXECUTED_URL - Mark executed URL (default: https://markexecuted-bwffy2zraq-uc.a.run.app)"
    echo "  MINOOTS_API_KEY           - API key for authentication (required)"
    echo "  MINOOTS_CHECK_INTERVAL    - Check interval in seconds (default: 30)"
}

# Main command handling
case "${1:-help}" in
    start)
        check_dependencies
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 2
        check_dependencies
        start_daemon
        ;;
    status)
        status_daemon
        ;;
    check)
        check_dependencies
        log_success "Configuration check passed"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac