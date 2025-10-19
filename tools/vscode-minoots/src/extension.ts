import * as vscode from 'vscode';
import fetch from 'node-fetch';

async function createTimer() {
  const apiKey = vscode.workspace.getConfiguration('minoots').get<string>('apiKey');
  const team = vscode.workspace.getConfiguration('minoots').get<string>('team');
  const apiBase = vscode.workspace.getConfiguration('minoots').get<string>('apiBase');

  if (!apiKey || !team) {
    vscode.window.showErrorMessage('Set minoots.apiKey and minoots.team in your VS Code settings.');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Timer name',
    placeHolder: 'deploy',
    validateInput(value) {
      return value.trim() ? undefined : 'Name is required';
    },
  });

  if (!name) {
    return;
  }

  const duration = await vscode.window.showInputBox({
    prompt: 'Duration (e.g. 5m, 1h)',
    placeHolder: '10m',
    validateInput(value) {
      return value.trim() ? undefined : 'Duration is required';
    },
  });

  if (!duration) {
    return;
  }

  const response = await fetch(`${apiBase}/timers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      team,
      name,
      duration,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    vscode.window.showErrorMessage(`Failed to create timer: ${text}`);
    return;
  }

  const payload = await response.json();
  vscode.window.showInformationMessage(`Timer ${payload.timer?.id ?? ''} created.`);
}

function openDashboard() {
  vscode.env.openExternal(vscode.Uri.parse('https://dashboard.minoots.dev'));
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('minoots.createTimer', createTimer),
    vscode.commands.registerCommand('minoots.openDashboard', openDashboard),
  );

  vscode.window.showInformationMessage('MINOOTS extension loaded.');
}

export function deactivate() {}
