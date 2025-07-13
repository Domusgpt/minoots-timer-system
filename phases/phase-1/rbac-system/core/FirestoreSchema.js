/**
 * MINOOTS RBAC - Firestore Schema Definitions
 * Defines the complete database schema for organizations, projects, and permissions
 */

const admin = require('firebase-admin');

/**
 * Firestore collection schemas and management
 */
class FirestoreSchemaManager {
  constructor(db = null) {
    this.db = db || admin.firestore();
  }

  /**
   * Initialize all required collections with proper indexes and security rules
   */
  async initializeSchema() {
    try {
      // Create initial collections and documents to establish schema
      await this.createSampleDocuments();
      
      // Set up composite indexes (these need to be created in Firebase Console)
      console.log('Schema initialized. Please create these composite indexes in Firebase Console:');
      console.log('1. Collection: organizations, Fields: members.[userId] (Ascending), createdAt (Descending)');
      console.log('2. Collection: projects, Fields: organizationId (Ascending), access.[userId] (Ascending)');
      console.log('3. Collection: timers, Fields: createdBy (Ascending), status (Ascending), endTime (Ascending)');
      console.log('4. Collection: audit_logs, Fields: userId (Ascending), type (Ascending), timestamp (Descending)');
      
      return true;
    } catch (error) {
      console.error('Failed to initialize schema:', error);
      throw error;
    }
  }

  /**
   * Create sample documents to establish collection schemas
   */
  async createSampleDocuments() {
    // Create a sample user document (will be replaced by real users)
    await this.db.collection('users').doc('_schema_sample').set({
      email: 'schema@example.com',
      name: 'Schema Sample',
      tier: 'free',
      isSystemAdmin: false,
      organizations: [],
      subscription: {
        tier: 'free',
        status: 'active',
        limits: {
          concurrentTimers: 5,
          monthlyTimers: 100,
          apiRequestsPerMinute: 10
        }
      },
      profile: {
        avatarUrl: null,
        timezone: 'UTC',
        notifications: {
          email: true,
          slack: false
        }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      lastClaimsSync: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create a sample organization document
    await this.db.collection('organizations').doc('_schema_sample').set({
      name: 'Schema Sample Org',
      slug: 'schema-sample',
      tier: 'team',
      members: {
        '_schema_sample_user': 'owner'
      },
      projects: ['_schema_sample_project'],
      settings: {
        billing: {
          customerId: null,
          subscriptionId: null,
          plan: 'team'
        },
        features: {
          sso: false,
          auditLogs: true,
          customIntegrations: false
        },
        limits: {
          maxMembers: 10,
          maxProjects: 50
        }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create a sample project document
    await this.db.collection('projects').doc('_schema_sample').set({
      name: 'Schema Sample Project',
      description: 'Sample project for schema definition',
      organizationId: '_schema_sample',
      access: {
        '_schema_sample_user': 'owner'
      },
      timers: ['_schema_sample_timer'],
      settings: {
        defaultTimerDuration: '1h',
        allowGuestAccess: false,
        webhookSettings: {
          defaultUrl: null,
          retryCount: 3
        }
      },
      metadata: {
        tags: ['sample', 'schema'],
        color: '#blue',
        archived: false
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create a sample timer document (in existing timers collection)
    await this.db.collection('timers').doc('_schema_sample').set({
      name: 'Schema Sample Timer',
      agentId: '_schema_sample_user',
      duration: 3600000, // 1 hour in ms
      startTime: Date.now(),
      endTime: Date.now() + 3600000,
      status: 'running',
      createdBy: '_schema_sample_user',
      projectId: '_schema_sample_project',
      organizationId: '_schema_sample',
      access: {
        '_schema_sample_user': 'owner'
      },
      events: {
        on_expire: {
          webhook: 'https://example.com/webhook',
          message: 'Timer expired',
          data: {}
        }
      },
      metadata: {
        tags: ['sample'],
        priority: 'normal',
        retryPolicy: {
          maxAttempts: 3,
          backoffSeconds: 60
        }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create sample audit log
    await this.db.collection('audit_logs').doc('_schema_sample').set({
      type: 'schema_initialization',
      userId: '_schema_sample_user',
      organizationId: '_schema_sample',
      resourceType: 'system',
      resourceId: null,
      action: 'initialize_schema',
      details: {
        message: 'Schema sample documents created',
        userAgent: 'MINOOTS-Schema-Manager',
        ipAddress: '127.0.0.1'
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('Sample schema documents created');
  }

  /**
   * Create a new organization with proper structure
   */
  async createOrganization(orgData, ownerId) {
    const orgId = orgData.id || this.db.collection('organizations').doc().id;
    
    const organization = {
      name: orgData.name,
      slug: orgData.slug || orgData.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      tier: orgData.tier || 'team',
      members: {
        [ownerId]: 'owner'
      },
      projects: [],
      settings: {
        billing: {
          customerId: null,
          subscriptionId: null,
          plan: orgData.tier || 'team'
        },
        features: {
          sso: orgData.tier === 'enterprise',
          auditLogs: ['team', 'enterprise'].includes(orgData.tier),
          customIntegrations: orgData.tier === 'enterprise'
        },
        limits: {
          maxMembers: orgData.tier === 'enterprise' ? -1 : 10,
          maxProjects: orgData.tier === 'enterprise' ? -1 : 50
        }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('organizations').doc(orgId).set(organization);
    
    // Update owner's user document
    await this.db.collection('users').doc(ownerId).update({
      organizations: admin.firestore.FieldValue.arrayUnion(orgId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { id: orgId, ...organization };
  }

  /**
   * Create a new project within an organization
   */
  async createProject(projectData, organizationId, creatorId) {
    const projectId = projectData.id || this.db.collection('projects').doc().id;
    
    const project = {
      name: projectData.name,
      description: projectData.description || '',
      organizationId: organizationId,
      access: {
        [creatorId]: 'owner'
      },
      timers: [],
      settings: {
        defaultTimerDuration: projectData.defaultTimerDuration || '1h',
        allowGuestAccess: projectData.allowGuestAccess || false,
        webhookSettings: {
          defaultUrl: projectData.defaultWebhook || null,
          retryCount: 3
        }
      },
      metadata: {
        tags: projectData.tags || [],
        color: projectData.color || '#blue',
        archived: false
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('projects').doc(projectId).set(project);
    
    // Add project to organization
    await this.db.collection('organizations').doc(organizationId).update({
      projects: admin.firestore.FieldValue.arrayUnion(projectId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { id: projectId, ...project };
  }

  /**
   * Add user to organization with specific role
   */
  async addUserToOrganization(userId, organizationId, role = 'editor') {
    const batch = this.db.batch();

    // Add user to organization members
    const orgRef = this.db.collection('organizations').doc(organizationId);
    batch.update(orgRef, {
      [`members.${userId}`]: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Add organization to user's list
    const userRef = this.db.collection('users').doc(userId);
    batch.update(userRef, {
      organizations: admin.firestore.FieldValue.arrayUnion(organizationId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // Log the action
    await this.logAuditEvent({
      type: 'user_added_to_organization',
      userId: userId,
      organizationId: organizationId,
      action: 'add_member',
      details: { role: role }
    });

    return true;
  }

  /**
   * Share project with user
   */
  async shareProject(projectId, userId, role = 'viewer') {
    await this.db.collection('projects').doc(projectId).update({
      [`access.${userId}`]: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log the action
    await this.logAuditEvent({
      type: 'project_shared',
      userId: userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'grant_access',
      details: { role: role }
    });

    return true;
  }

  /**
   * Log audit event
   */
  async logAuditEvent(eventData) {
    const auditLog = {
      type: eventData.type,
      userId: eventData.userId,
      organizationId: eventData.organizationId || null,
      resourceType: eventData.resourceType || null,
      resourceId: eventData.resourceId || null,
      action: eventData.action,
      details: eventData.details || {},
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('audit_logs').add(auditLog);
  }

  /**
   * Clean up schema sample documents
   */
  async cleanupSampleDocuments() {
    const batch = this.db.batch();

    batch.delete(this.db.collection('users').doc('_schema_sample'));
    batch.delete(this.db.collection('organizations').doc('_schema_sample'));
    batch.delete(this.db.collection('projects').doc('_schema_sample'));
    batch.delete(this.db.collection('timers').doc('_schema_sample'));
    batch.delete(this.db.collection('audit_logs').doc('_schema_sample'));

    await batch.commit();
    console.log('Sample schema documents cleaned up');
  }
}

/**
 * Firestore Security Rules (to be applied in Firebase Console)
 */
const SECURITY_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Organization access based on membership
    match /organizations/{orgId} {
      allow read: if request.auth != null && 
        resource.data.members[request.auth.uid] != null;
      allow write: if request.auth != null && 
        resource.data.members[request.auth.uid] in ['admin', 'owner'];
    }
    
    // Project access based on organization membership or direct access
    match /projects/{projectId} {
      allow read: if request.auth != null && (
        resource.data.access[request.auth.uid] != null ||
        exists(/databases/$(database)/documents/organizations/$(resource.data.organizationId)) &&
        get(/databases/$(database)/documents/organizations/$(resource.data.organizationId)).data.members[request.auth.uid] != null
      );
      allow write: if request.auth != null && 
        resource.data.access[request.auth.uid] in ['manager', 'admin', 'owner'];
    }
    
    // Timer access based on project access and ownership
    match /timers/{timerId} {
      allow read, write: if request.auth != null && (
        resource.data.createdBy == request.auth.uid ||
        resource.data.access[request.auth.uid] != null ||
        (resource.data.projectId != null && 
         exists(/databases/$(database)/documents/projects/$(resource.data.projectId)) &&
         get(/databases/$(database)/documents/projects/$(resource.data.projectId)).data.access[request.auth.uid] != null)
      );
    }
    
    // Audit logs readable by organization admins
    match /audit_logs/{logId} {
      allow read: if request.auth != null && (
        request.auth.token.admin == true ||
        (resource.data.organizationId != null &&
         exists(/databases/$(database)/documents/organizations/$(resource.data.organizationId)) &&
         get(/databases/$(database)/documents/organizations/$(resource.data.organizationId)).data.members[request.auth.uid] in ['admin', 'owner'])
      );
    }
  }
}
`;

module.exports = {
  FirestoreSchemaManager,
  SECURITY_RULES
};