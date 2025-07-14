#!/bin/bash

##############################################################################
# MINOOTS TIMER DAEMON INSTALLER
# Installs the system daemon across different platforms
##############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_SCRIPT="$SCRIPT_DIR/minoots-timer-daemon.sh"
SERVICE_NAME="minoots-timer-daemon"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}INFO: $1${NC}"
}

log_success() {
    echo -e "${GREEN}SUCCESS: $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}WARNING: $1${NC}"
}

log_error() {
    echo -e "${RED}ERROR: $1${NC}"
}

check_dependencies() {
    log_info "Checking system dependencies..."
    
    # Check for required commands
    local missing_deps=()
    
    if ! command -v claude >/dev/null 2>&1; then
        missing_deps+=("claude")
    fi
    
    if ! command -v curl >/dev/null 2>&1; then
        missing_deps+=("curl")
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_info "Please install missing dependencies and try again"
        return 1
    fi
    
    log_success "All dependencies satisfied"
    return 0
}

setup_environment() {
    log_info "Setting up environment..."
    
    # Get user input for configuration
    read -p "Enter your MINOOTS API key: " -s MINOOTS_API_KEY
    echo
    
    if [ -z "$MINOOTS_API_KEY" ]; then
        log_error "API key is required"
        return 1
    fi
    
    # Default values
    MINOOTS_USER_ID="${USER:-$(whoami)}_$(hostname)"
    MINOOTS_BRIDGE_API="https://bridge.minoots.com"
    MINOOTS_CHECK_INTERVAL="30"
    
    # Ask for customization
    read -p "User ID [$MINOOTS_USER_ID]: " input_user_id
    MINOOTS_USER_ID="${input_user_id:-$MINOOTS_USER_ID}"
    
    read -p "Bridge API URL [$MINOOTS_BRIDGE_API]: " input_bridge_api
    MINOOTS_BRIDGE_API="${input_bridge_api:-$MINOOTS_BRIDGE_API}"
    
    read -p "Check interval in seconds [$MINOOTS_CHECK_INTERVAL]: " input_interval
    MINOOTS_CHECK_INTERVAL="${input_interval:-$MINOOTS_CHECK_INTERVAL}"
    
    log_success "Environment configured"
    log_info "User ID: $MINOOTS_USER_ID"
    log_info "Bridge API: $MINOOTS_BRIDGE_API"
    log_info "Check interval: ${MINOOTS_CHECK_INTERVAL}s"
}

install_systemd_service() {
    log_info "Installing systemd service..."
    
    # Copy daemon script to system location
    sudo cp "$DAEMON_SCRIPT" /usr/local/bin/minoots-timer-daemon
    sudo chmod +x /usr/local/bin/minoots-timer-daemon
    
    # Create systemd service file
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=MINOOTS Timer Command Daemon
Documentation=https://github.com/Domusgpt/minoots-timer-system
After=network.target
Wants=network.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$HOME
ExecStart=/usr/local/bin/minoots-timer-daemon start
ExecStop=/usr/local/bin/minoots-timer-daemon stop
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Environment variables
Environment=MINOOTS_USER_ID=$MINOOTS_USER_ID
Environment=MINOOTS_BRIDGE_API=$MINOOTS_BRIDGE_API
Environment=MINOOTS_API_KEY=$MINOOTS_API_KEY
Environment=MINOOTS_CHECK_INTERVAL=$MINOOTS_CHECK_INTERVAL
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=$HOME

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$HOME/.cache $HOME/.config /tmp

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable service
    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}
    
    log_success "Systemd service installed and enabled"
}

install_macos_launchd() {
    log_info "Installing macOS LaunchAgent..."
    
    local plist_file="$HOME/Library/LaunchAgents/com.minoots.timer-daemon.plist"
    
    # Create plist file
    cat > "$plist_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.minoots.timer-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DAEMON_SCRIPT</string>
        <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MINOOTS_USER_ID</key>
        <string>$MINOOTS_USER_ID</string>
        <key>MINOOTS_BRIDGE_API</key>
        <string>$MINOOTS_BRIDGE_API</string>
        <key>MINOOTS_API_KEY</key>
        <string>$MINOOTS_API_KEY</string>
        <key>MINOOTS_CHECK_INTERVAL</key>
        <string>$MINOOTS_CHECK_INTERVAL</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/minoots-timer-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/minoots-timer-daemon.log</string>
</dict>
</plist>
EOF

    # Load the service
    launchctl load "$plist_file"
    
    log_success "macOS LaunchAgent installed and loaded"
}

install_windows_service() {
    log_warning "Windows service installation not implemented yet"
    log_info "For Windows, you can run the daemon manually:"
    log_info "MINOOTS_API_KEY='$MINOOTS_API_KEY' ./minoots-timer-daemon.sh start"
}

uninstall_service() {
    log_info "Uninstalling MINOOTS Timer Daemon..."
    
    if command -v systemctl >/dev/null 2>&1; then
        # Linux with systemd
        sudo systemctl stop ${SERVICE_NAME} 2>/dev/null || true
        sudo systemctl disable ${SERVICE_NAME} 2>/dev/null || true
        sudo rm -f /etc/systemd/system/${SERVICE_NAME}.service
        sudo rm -f /usr/local/bin/minoots-timer-daemon
        sudo systemctl daemon-reload
        log_success "Systemd service uninstalled"
        
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local plist_file="$HOME/Library/LaunchAgents/com.minoots.timer-daemon.plist"
        launchctl unload "$plist_file" 2>/dev/null || true
        rm -f "$plist_file"
        log_success "macOS LaunchAgent uninstalled"
        
    else
        log_warning "Unknown platform, manual cleanup may be required"
    fi
}

start_service() {
    log_info "Starting MINOOTS Timer Daemon..."
    
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start ${SERVICE_NAME}
        sudo systemctl status ${SERVICE_NAME} --no-pager
        
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        local plist_file="$HOME/Library/LaunchAgents/com.minoots.timer-daemon.plist"
        launchctl start com.minoots.timer-daemon
        log_success "macOS LaunchAgent started"
        
    else
        log_info "Starting daemon manually..."
        MINOOTS_API_KEY="$MINOOTS_API_KEY" \
        MINOOTS_USER_ID="$MINOOTS_USER_ID" \
        MINOOTS_BRIDGE_API="$MINOOTS_BRIDGE_API" \
        MINOOTS_CHECK_INTERVAL="$MINOOTS_CHECK_INTERVAL" \
        "$DAEMON_SCRIPT" start
    fi
}

show_status() {
    log_info "Checking daemon status..."
    
    if command -v systemctl >/dev/null 2>&1; then
        systemctl status ${SERVICE_NAME} --no-pager
        
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        launchctl list | grep com.minoots.timer-daemon || log_warning "Service not running"
        
    else
        "$DAEMON_SCRIPT" status
    fi
}

show_help() {
    echo "MINOOTS Timer Daemon Installer"
    echo "Usage: $0 {install|uninstall|start|stop|status|help}"
    echo ""
    echo "Commands:"
    echo "  install    - Install and configure the daemon"
    echo "  uninstall  - Remove the daemon"
    echo "  start      - Start the daemon service"
    echo "  stop       - Stop the daemon service"
    echo "  status     - Check daemon status"
    echo "  help       - Show this help"
}

# Main command handling
case "${1:-help}" in
    install)
        if ! check_dependencies; then
            exit 1
        fi
        
        setup_environment
        
        if command -v systemctl >/dev/null 2>&1; then
            install_systemd_service
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            install_macos_launchd
        elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
            install_windows_service
        else
            log_warning "Unknown platform, install manually"
            exit 1
        fi
        
        log_success "🎉 MINOOTS Timer Daemon installed successfully!"
        log_info "The daemon will automatically start monitoring for timer commands."
        ;;
        
    uninstall)
        uninstall_service
        ;;
        
    start)
        start_service
        ;;
        
    stop)
        if command -v systemctl >/dev/null 2>&1; then
            sudo systemctl stop ${SERVICE_NAME}
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            launchctl stop com.minoots.timer-daemon
        else
            "$DAEMON_SCRIPT" stop
        fi
        ;;
        
    status)
        show_status
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