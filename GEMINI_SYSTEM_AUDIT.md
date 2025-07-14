#  Gemini System Audit & Remediation Plan

**Audit Date:** 2025-07-14

## 1. Executive Summary

This audit has identified several critical architectural and security issues that prevent the `minoots-timer-system` from functioning as intended. The core problem is a fundamental mismatch between three key components: the **`system-daemon`**, the **`webhook-bridge`**, and the now-archived **`mcp-timer-bridge`**. The system is not integrated, and the components are incompatible.

**Key Findings:**
1.  **Architectural Incoherence:** The project contains at least two conflicting and incompatible "bridge" systems for handling timer webhooks. The `system-daemon` is designed to work with the cloud-based `webhook-bridge`, but local testing was attempting to use the incompatible `mcp-timer-bridge`.
2.  **Critical Security Vulnerability:** The production `webhook-bridge` is designed to be unauthenticated, creating a direct command injection vulnerability into the user's terminal via the `system-daemon`.
3.  **Deployment and Configuration Issues:** The `webhook-bridge` has outdated dependencies (Node.js 18) and incorrect Firebase deployment configurations.
4.  **Untracked Critical Code:** The `webhook-bridge` directory, which is essential for the production workflow, is not being tracked by the main project's git repository. This is a major source of confusion and deployment failures.

This document provides a detailed breakdown of each issue and a clear, step-by-step remediation plan to create a secure, functional, and maintainable system.

---

## 2. Detailed Issue Analysis & Remediation

### Issue #1: Architectural Incoherence & Incompatibility

**Analysis:**
The project contains two conflicting implementations for handling timer webhooks, leading to total system failure.

*   **`webhook-bridge/`**: A Firebase Functions application intended for **production**. It stores commands in Firestore and is designed to be polled by the `system-daemon`.
*   **`mcp-timer-bridge/` (Archived)**: A local Node.js/Express server intended for **local development/testing**. It stores commands in-memory.
*   **`system-daemon/`**: This component is hardcoded to expect the API structure and data format of the **`webhook-bridge`**, but testing was being attempted against the **`mcp-timer-bridge`**.

**Result:** The system is fundamentally broken. The daemon cannot communicate with the bridge it was being tested against.

**Remediation Plan:**
1.  **Clarify Architecture:** Formally document that `webhook-bridge` is the sole production system and `mcp-timer-bridge` is a deprecated local prototype. (This has been partially done in `CORRECTED_ARCHITECTURE_UNDERSTANDING.md`, but needs to be central).
2.  **Focus on One System:** All development and testing efforts must focus exclusively on making the `webhook-bridge` and `system-daemon` work together.
3.  **Remove Ambiguity:** The archived `mcp-timer-bridge` should be deleted or kept strictly for historical reference, but never used for active development.

---

### Issue #2: Critical Security Vulnerability - Command Injection

**Analysis:**
The most severe issue is the unauthenticated nature of the `webhook-bridge`.

1.  The `webhook` function in `webhook-bridge/functions/index.js` is configured to be publicly accessible to receive calls from the MINOOTS API.
2.  The `system-daemon` polls this bridge, fetches the command data, and then executes it directly in a terminal session using `claude --resume`.
3.  **The Vulnerability:** Anyone on the internet who discovers the webhook URL (`https://webhook-bwffy2zraq-uc.a.run.app/{userId}`) can send a crafted POST request containing a malicious command. The daemon will blindly fetch and execute this command, giving the attacker arbitrary code execution on the user's machine.

**Result:** This is a critical, high-severity vulnerability that makes the system completely unsafe for use.

**Remediation Plan:**
1.  **Implement Webhook Signature Verification (HMAC):** This is the standard and most secure solution for public webhooks.
    *   **MINOOTS API (Sender):** When creating a timer, the user will provide a secret signing key. When the timer expires, the API will generate a signature (e.g., an HMAC-SHA256 hash of the request body using the secret key) and include it in a request header (e.g., `X-Minoots-Signature`).
    *   **`webhook-bridge` (Receiver):** The `webhook` function must be modified to:
        a. Expect this signature header.
        b. Re-calculate the signature on its end using the stored secret key.
        c. **Reject any request where the signatures do not match.**
2.  **Store Webhook Secrets:** Add a secure way for users to configure and store their webhook signing secrets within the MINOOTS system.
3.  **Update Documentation:** The `AGENT_VISUAL_GUIDE.md` and other docs must be updated to reflect this new, secure setup.

---

### Issue #3: Deployment & Configuration Issues

**Analysis:**
The `webhook-bridge` Firebase project is misconfigured.

1.  **Outdated Runtime:** `firebase.json` and `functions/package.json` specify `nodejs18`, which is deprecated and will be decommissioned. The main MINOOTS API uses `nodejs20`.
2.  **Incorrect Deployment Logic:** The deployment process was failing silently (`Skipped (No changes detected)`) because changes were not being committed to git before running `firebase deploy`. Firebase CLI uses git history to detect changes.
3.  **Missing `onInit()` Best Practices:** While `onInit()` is used, the initialization of `firebase-admin` and `firestore` could be further optimized as per Firebase v2 standards to ensure reliability.

**Remediation Plan:**
1.  **Upgrade Node.js Runtime:** Update `firebase.json` and `functions/package.json` in the `webhook-bridge` directory to use `nodejs20`.
2.  **Standardize Deployment Workflow:** Document and enforce the correct deployment workflow:
    ```bash
    # 1. Navigate to the correct directory
    cd /mnt/c/Users/millz/minoots-timer-system/webhook-bridge

    # 2. Add and commit all changes to git FIRST
    git add .
    git commit -m "feat: Update webhook security"

    # 3. Push changes to remote
    git push origin <branch_name>

    # 4. Then, deploy to Firebase
    firebase deploy --only functions
    ```
3.  **Review `onInit()`:** Ensure all global variables and configurations are initialized within `onInit()` to prevent cold start issues and deployment timeouts, following the official Firebase documentation patterns we reviewed.

---

### Issue #4: Untracked Critical Code (Git Issue)

**Analysis:**
The `webhook-bridge` directory is not being tracked by the main `minoots-timer-system` git repository. When running `git status` from the root, changes inside `webhook-bridge/` do not appear. This is the root cause of the deployment failures and a major source of confusion. The directory is not in the `.gitignore`, which suggests it might be a git submodule that was not initialized correctly, or it was added in a way that the parent repository is ignoring it.

**Result:** This makes it impossible to version control, deploy reliably, or collaborate on the most critical piece of the production infrastructure.

**Remediation Plan:**
1.  **Fix Git Tracking:** The `webhook-bridge` directory must be properly added to the main git repository.
    *   **If it was a failed submodule:** It needs to be removed and re-added correctly. The command `git rm --cached webhook-bridge` (run from the root) might be necessary to un-track the folder itself before re-adding its contents.
    *   **If it was never added:** It simply needs to be added: `git add webhook-bridge/` and committed.
2.  **Verify:** After the fix, running `git status` from the root directory must show changes made to files within `webhook-bridge/`. This is the critical success metric.

---

## 3. Recommended Path Forward

1.  **PAUSE ALL FEATURE DEVELOPMENT.** The identified security and architectural flaws must be addressed before any other work continues.
2.  **Fix the Git Issue (Issue #4):** This is the highest priority. Without proper version control of the `webhook-bridge`, no other fix can be reliably implemented or deployed.
3.  **Implement Webhook Security (Issue #2):** Secure the `webhook-bridge` with HMAC signature verification. This is non-negotiable for a system that executes terminal commands.
4.  **Correct Deployment Configuration (Issue #3):** Upgrade the Node.js runtime and standardize the deployment process.
5.  **Test the Integrated System:** Once the above are fixed, perform a full end-to-end test of the `Timer -> MINOOTS API -> Webhook Bridge -> System Daemon -> Claude Code` flow.
6.  **Update All Documentation:** All user-facing and internal documents must be updated to reflect the new, secure, and correct architecture.
