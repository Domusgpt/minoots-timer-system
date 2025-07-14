# Implementation Backlog

**Features and fixes discovered during documentation verification that should be implemented**

## 🚨 CRITICAL BUGS TO FIX

### API Endpoints
- **Missing /docs endpoint** - Listed as free endpoint but doesn't exist (returns 404)
- **Broken invite endpoint** - `inviteUserToOrganization()` method doesn't exist, API crashes
- **Fake signup URLs** - API returns non-existent URLs when anonymous limits hit

### MCP Integration  
- **MCP server authentication broken** - `makeAPIRequest()` has no x-api-key header, all calls will fail
- **MCP config environment variable** - `process.env.FUNCTIONS_SOURCE` might not be set, returns broken path

### Missing Features
- **No API key signup process** - Users can't actually get API keys (tutorial unusable)
- **Analytics permission without implementation** - Users get `view_analytics` permission but no endpoints exist

## 📝 DOCUMENTATION FIXES COMPLETED

### Fixed in Documents:
- ✅ **MONITORING.md** - Fixed collection name (usage_tracking → usage)
- ✅ **QUICK_START.md** - Fixed tier confusion (anonymous vs free limits)  
- ✅ **MCP_INTEGRATION.md** - Fixed line numbers (73-205 → 72-236)
- ✅ **API_REFERENCE.md** - Noted missing /docs and broken invite endpoints

## 🔮 FUTURE ENHANCEMENTS

### Analytics System
- Implement actual analytics endpoints to match `view_analytics` permission
- Build dashboard for team/enterprise users
- Usage charts and reporting

### Authentication Improvements  
- Build proper API key signup flow
- User registration system
- Account management UI

### MCP Server Fixes
- Add proper authentication to MCP server
- Test and fix environment variable issues
- Improve error handling

### Advanced Features
- Organization invite system (implement missing method)
- User management UI
- Better webhook retry logic
- Structured logging system

## 📋 TRACKING NOTES

**Documentation Status**: All 8 core documents verified and corrected
**Code Issues**: 13 bugs/features identified for future implementation  
**Priority**: Fix critical API bugs first, then missing features, then enhancements

---

**Last Updated**: During documentation verification process
**Next Action**: Implement critical bug fixes when ready for development phase