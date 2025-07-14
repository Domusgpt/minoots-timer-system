# MINOOTS Timer System

**An independent timer system for autonomous agents and workflows, built on Firebase and Google Cloud Functions.**

MINOOTS provides a robust and scalable API for creating, managing, and monitoring timers. It is designed to be a reliable backend for AI agents, automated workflows, and any application requiring precise time-based event triggering.

## ✨ Features

*   **Timer Management**: Create, retrieve, list, and delete timers with flexible durations.
*   **Webhook Notifications**: Trigger HTTP POST requests to a specified URL when a timer expires.
*   **Role-Based Access Control (RBAC)**: Secure API endpoints with a granular permission system for users and organizations.
*   **Tier-Based Rate Limiting**: Dynamic rate limits applied based on user subscription tiers.
*   **API Key Authentication**: Simple and secure access to the API using unique API keys.
*   **Organization & Project Support**: Basic structures for grouping users and timers into organizations and projects.
*   **Model Context Protocol (MCP) Integration**: Experimental support for Claude agents to interact with the timer system.

## 🚀 Getting Started

### 1. API Access

MINOOTS is an API-first service. You will need an API key to interact with the system. Currently, API keys are managed directly within the Firebase project for authenticated users.

### 2. Core API Endpoints

*   `POST /timers`: Create a new timer.
*   `GET /timers/{id}`: Get details of a specific timer.
*   `GET /timers`: List timers.
*   `DELETE /timers/{id}`: Delete a timer.
*   `POST /quick/wait`: Create a simple delay timer.
*   `GET /health`: Check API health status.

### 3. Authentication

Authenticate your requests using the `x-api-key` header with your generated API key:

```http
x-api-key: your_api_key_here
```

## 🛠️ Development & Deployment

MINOOTS is built on Firebase and Google Cloud Functions. Deployment is handled via the Firebase CLI.

### Prerequisites

*   Node.js (>=18.0.0)
*   Firebase CLI (`npm install -g firebase-tools`)

### Local Development

1.  Clone the repository.
2.  Navigate to the `functions` directory: `cd functions`
3.  Install dependencies: `npm install`
4.  Start the Firebase emulator suite (requires Firebase project setup).

### Deployment

Deploy functions and Firestore rules using the Firebase CLI:

```bash
firebase deploy --only functions,firestore
```

## 📚 Documentation

This project aims to provide clear and accurate documentation. Please refer to the specific guides for more details:

*   [API Quickstart](./API_QUICKSTART.md)
*   [API Reference](./API_REFERENCE.md)
*   [Webhooks](./WEBHOOKS.md)
*   [Permissions](./PERMISSIONS.md)
*   [Claude Integration](./CLAUDE_INTEGRATION.md)

## ⚠️ Important Notes

*   **Current State**: This system is under active development. Features and documentation are being refined.
*   **Webhook Limitations**: The current webhook implementation is basic (fire-and-forget, no retries or advanced events).
*   **Team Features**: Organization and project management are foundational; advanced features like team-level API keys and detailed analytics are not yet implemented.

## 📞 Support

For any questions or issues, please refer to the project's GitHub repository or contact the development team.
