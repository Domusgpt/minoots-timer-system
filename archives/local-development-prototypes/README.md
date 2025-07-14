# 📁 LOCAL DEVELOPMENT PROTOTYPES ARCHIVE

## 🚨 IMPORTANT NOTICE

**These are LOCAL DEVELOPMENT PROTOTYPES that are NOT part of the production system.**

They were moved here to prevent confusion with the actual production architecture.

## 📦 ARCHIVED SYSTEMS

### **mcp-timer-bridge/**
- **What**: Local Express server prototype for MCP integration
- **Why Archived**: Not compatible with production daemon architecture
- **Production Alternative**: `webhook-bridge/` Firebase Functions

## 🏗️ PRODUCTION SYSTEMS TO USE

- **webhook-bridge/**: Firebase Functions for cloud command queue
- **system-daemon/**: Daemon that polls cloud Firebase Functions
- **functions/**: Main MINOOTS API with timer management

## ⚠️ DO NOT USE ARCHIVED SYSTEMS

These archived systems will cause confusion and incompatibility issues. Always use the production systems documented in the main project structure.

---

**RULE**: If it's in archives/, it's NOT production code.