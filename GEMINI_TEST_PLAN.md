# Gemini Test Plan: End-to-End System Verification

**Objective:** To verify the complete, secure workflow from timer creation to command execution by the system daemon.

**Pre-requisites:**
1.  **CRITICAL:** The git tracking issue with the `webhook-bridge` directory must be resolved.
2.  A `MINOOTS_WEBHOOK_SECRET` environment variable must be set in both the main `functions` and `webhook-bridge/functions` environments. This should be a long, random string.

---

## Test Execution Steps

### Step 1: Deploy All Services

1.  **Deploy the Main MINOOTS API:**
    ```bash
    # Navigate to the main functions directory
    cd /mnt/c/Users/millz/minoots-timer-system/functions

    # Commit any pending changes (IMPORTANT)
    git add . && git commit -m "Deploying main API with webhook signing"

    # Deploy
    firebase deploy --only functions
    ```

2.  **Deploy the Webhook Bridge:**
    ```bash
    # Navigate to the webhook-bridge directory
    cd /mnt/c/Users/millz/minoots-timer-system/webhook-bridge

    # Commit the security and runtime fixes (IMPORTANT)
    git add . && git commit -m "Deploying secure webhook bridge"

    # Deploy
    firebase deploy --only functions
    ```

### Step 2: Start the System Daemon

1.  **Open a new terminal** on your local machine.
2.  **Navigate to the daemon directory:**
    ```bash
    cd /mnt/c/Users/millz/minoots-timer-system/system-daemon
    ```
3.  **Set the required environment variables:**
    ```bash
    export MINOOTS_API_KEY="your_minoots_api_key"
    export MINOOTS_COMMANDS_URL="https://commands-bwffy2zraq-uc.a.run.app" # Use the deployed URL
    export MINOOTS_MARK_EXECUTED_URL="https://markexecuted-bwffy2zraq-uc.a.run.app" # Use the deployed URL
    ```
4.  **Start the daemon:**
    ```bash
    ./minoots-timer-daemon.sh start
    ```
5.  **Monitor the daemon's logs in real-time:**
    ```bash
    tail -f /tmp/minoots-timer-daemon.log
    ```
    *(You should see it polling for commands.)*

### Step 3: Create the Test Timer

1.  **Open another terminal.**
2.  **Execute the following `curl` command** to create a timer that will trigger the full workflow. This command will tell the daemon to `echo` a success message.

    ```bash
    curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
    -H "x-api-key: your_minoots_api_key" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Gemini End-to-End Test",
      "duration": "20s",
      "events": {
        "on_expire": {
          "webhook": "https://webhook-bwffy2zraq-uc.a.run.app/your_user_id",
          "message": "Executing test command",
          "data": {
            "command": "echo [SUCCESS] Gemini end-to-end test successful!",
            "session_id": "gemini_test_session",
            "working_directory": "/tmp"
          }
        }
      }
    }'
    ```
    *(Replace `your_user_id` with your actual user ID and `your_minoots_api_key` with a valid key.)*

### Step 4: Verify the Results

1.  **Watch the daemon logs.** After 20 seconds, you should see the following sequence:
    *   The daemon will log that it found a new command.
    *   It will log that it is executing the `echo` command.
    *   You will see the output: `[SUCCESS] Gemini end-to-end test successful!`
    *   The daemon will log that it is marking the command as executed.

2.  **Check the Firestore Database:**
    *   Navigate to the `user_commands/{your_user_id}/pending` collection in your Firestore console.
    *   You should see a document for the command that was just executed.
    *   The `executed` field in that document should be `true`.

---

## Expected Outcome

If all steps are successful, you will have verified that:
- The main API correctly creates a timer and sends a secure webhook.
- The `webhook-bridge` correctly authenticates the webhook and queues the command.
- The `system-daemon` correctly polls for, receives, and executes the command.

This confirms that the core architecture is sound and the security vulnerability has been closed.
