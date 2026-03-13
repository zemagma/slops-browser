/**
 * Node Status Module
 *
 * Node cards, status badges, Swarm notifications.
 */

import { state, buildBeeUrl } from '../state.js';
import { formatBalance, formatBytes } from './wallet-utils.js';

// DOM references
let swarmModeBadge;
let swarmStatusBadge;
let swarmBalanceXdaiEl;
let swarmBalanceXbzzEl;
let swarmStampsCount;
let swarmStampsSummary;
let swarmUpgradeCta;
let walletNotification;
let walletNotificationText;
let walletNotificationAction;

let desiredSwarmMode = 'ultraLight';
let actualSwarmMode = null;

// Node status tracking
let nodeStatusUnsubscribers = [];

export function initNodeStatus() {
  // Node card elements
  swarmModeBadge = document.getElementById('swarm-mode-badge');
  swarmStatusBadge = document.getElementById('swarm-status-badge');
  swarmBalanceXdaiEl = document.getElementById('swarm-balance-xdai');
  swarmBalanceXbzzEl = document.getElementById('swarm-balance-xbzz');
  swarmStampsCount = document.getElementById('swarm-stamps-count');
  swarmStampsSummary = document.getElementById('swarm-stamps-summary');
  swarmUpgradeCta = document.getElementById('swarm-upgrade-cta');

  // Notification elements
  walletNotification = document.getElementById('wallet-notification');
  walletNotificationText = document.getElementById('wallet-notification-text');
  walletNotificationAction = document.getElementById('wallet-notification-action');

  // Setup node card collapse/expand
  setupNodeCards();

  syncDesiredSwarmMode();
  window.addEventListener('settings:updated', handleSettingsUpdated);

  // Subscribe to node status updates
  subscribeToNodeStatus();
}

// ============================================
// Node Cards (Collapsible)
// ============================================

function setupNodeCards() {
  // Add click listeners to all node card headers
  document.querySelectorAll('.node-card-header').forEach((header) => {
    header.addEventListener('click', () => {
      const nodeName = header.dataset.node;
      toggleNodeCard(nodeName);
    });
  });

  // Upgrade node button
  const upgradeBtn = document.getElementById('swarm-upgrade-btn');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleUpgradeNode();
    });
  }
}

function handleSendToNode(token) {
  // TODO: Implement send flow
  console.log(`[WalletUI] Send ${token} to node - not yet implemented`);
}

function toggleNodeCard(nodeName) {
  const card = document.getElementById(`node-card-${nodeName}`);
  const content = document.getElementById(`${nodeName}-card-content`);

  if (!card || !content) return;

  const isExpanded = card.classList.contains('expanded');

  if (isExpanded) {
    card.classList.remove('expanded');
    content.classList.add('hidden');
  } else {
    card.classList.add('expanded');
    content.classList.remove('hidden');
  }
}

function formatSwarmMode(mode) {
  switch (mode) {
    case 'full':
      return 'Full';
    case 'light':
      return 'Light';
    case 'ultraLight':
      return 'Ultra-light';
    default:
      return '--';
  }
}

function getDisplayedSwarmMode() {
  if (actualSwarmMode) {
    return actualSwarmMode;
  }

  if (state.registry?.bee?.mode !== 'reused') {
    return desiredSwarmMode;
  }

  return null;
}

function updateSwarmModeUi() {
  if (swarmModeBadge) {
    swarmModeBadge.textContent = formatSwarmMode(getDisplayedSwarmMode());
  }

  if (swarmUpgradeCta) {
    const displayMode = getDisplayedSwarmMode();
    swarmUpgradeCta.classList.toggle('hidden', displayMode === 'light' || displayMode === 'full');
  }
}

async function syncDesiredSwarmMode() {
  try {
    const settings = await window.electronAPI?.getSettings?.();
    desiredSwarmMode = settings?.beeNodeMode === 'light' ? 'light' : 'ultraLight';
  } catch {
    desiredSwarmMode = 'ultraLight';
  }

  updateSwarmModeUi();
}

function handleSettingsUpdated(event) {
  desiredSwarmMode = event.detail?.beeNodeMode === 'light' ? 'light' : 'ultraLight';
  if (state.currentBeeStatus !== 'running' || state.registry?.bee?.mode !== 'reused') {
    updateSwarmModeUi();
  }
}

async function restartBundledBeeForModeChange() {
  await window.bee?.stop?.();
  await window.bee?.start?.();
}

async function updateBeeModeSetting(nextMode) {
  const settings = await window.electronAPI.getSettings();
  const nextSettings = { ...settings, beeNodeMode: nextMode };
  const success = await window.electronAPI.saveSettings(nextSettings);

  if (!success) {
    throw new Error('Failed to save Swarm node mode');
  }

  window.dispatchEvent(
    new CustomEvent('settings:updated', {
      detail: nextSettings,
    })
  );
}

async function handleUpgradeNode() {
  try {
    if (state.registry?.bee?.mode === 'reused') {
      alert(
        'Freedom is using an existing Swarm node. Switch that node to light mode outside Freedom to enable uploads and publishing.'
      );
      return;
    }

    if (desiredSwarmMode === 'light') {
      updateSwarmModeUi();
      return;
    }

    const shouldUpgrade = window.confirm(
      'Switch the Swarm node to light mode? Freedom will restart the bundled node so it can publish content.'
    );
    if (!shouldUpgrade) {
      return;
    }

    await updateBeeModeSetting('light');

    if (state.currentBeeStatus === 'running' || state.currentBeeStatus === 'starting') {
      await restartBundledBeeForModeChange();
    }
  } catch (err) {
    console.error('[WalletUI] Failed to upgrade Swarm node:', err);
    alert(err.message || 'Failed to switch Swarm node to light mode');
  }
}

// ============================================
// Node Status Subscriptions
// ============================================

function subscribeToNodeStatus() {
  // Clean up any existing subscriptions
  nodeStatusUnsubscribers.forEach((unsub) => unsub?.());
  nodeStatusUnsubscribers = [];

  // Subscribe to Swarm/Bee status
  if (window.bee?.onStatusUpdate) {
    const unsubBee = window.bee.onStatusUpdate(({ status, error }) => {
      updateSwarmStatus(status, error);
    });
    if (unsubBee) nodeStatusUnsubscribers.push(unsubBee);
  }

  // Subscribe to IPFS status
  if (window.ipfs?.onStatusUpdate) {
    const unsubIpfs = window.ipfs.onStatusUpdate(({ status, error }) => {
      updateIpfsStatus(status, error);
    });
    if (unsubIpfs) nodeStatusUnsubscribers.push(unsubIpfs);
  }

  // Subscribe to Radicle status
  if (window.radicle?.onStatusUpdate) {
    const unsubRadicle = window.radicle.onStatusUpdate(({ status, error }) => {
      updateRadicleStatus(status, error);
    });
    if (unsubRadicle) nodeStatusUnsubscribers.push(unsubRadicle);
  }

  // Get initial status
  fetchInitialNodeStatus();
}

async function fetchInitialNodeStatus() {
  try {
    if (window.bee?.getStatus) {
      const { status, error } = await window.bee.getStatus();
      updateSwarmStatus(status, error);
    }

    if (window.ipfs?.getStatus) {
      const { status, error } = await window.ipfs.getStatus();
      updateIpfsStatus(status, error);
    }

    if (window.radicle?.getStatus) {
      const { status, error } = await window.radicle.getStatus();
      updateRadicleStatus(status, error);
    }
  } catch (err) {
    console.error('[WalletUI] Failed to fetch initial node status:', err);
  }
}

function getStatusBadgeState(status) {
  switch (status) {
    case 'running':
      return { text: 'Running', value: 'running' };
    case 'starting':
      return { text: 'Starting', value: 'starting' };
    case 'stopping':
      return { text: 'Stopping', value: 'starting' };
    case 'error':
      return { text: 'Error', value: 'error' };
    case 'stopped':
    default:
      return { text: 'Stopped', value: 'stopped' };
  }
}

function updateSwarmStatus(status, _error) {
  if (swarmStatusBadge) {
    const badgeState = getStatusBadgeState(status);
    swarmStatusBadge.textContent = badgeState.text;
    swarmStatusBadge.dataset.status = badgeState.value;
  }

  if (status === 'running') {
    fetchSwarmMode();
    hideNotification();
  } else {
    actualSwarmMode = null;
    updateSwarmModeUi();
  }
}

async function fetchSwarmMode() {
  if (!swarmModeBadge) return;

  try {
    const response = await fetch(buildBeeUrl('/node'));
    if (response.ok) {
      const data = await response.json();
      if (data.beeMode) {
        actualSwarmMode = data.beeMode;
        updateSwarmModeUi();
      }
    }
  } catch (err) {
    console.error('[WalletUI] Failed to fetch Swarm mode:', err);
    actualSwarmMode = null;
    updateSwarmModeUi();
  }
}

function updateIpfsStatus(status, _error) {
  const badge = document.getElementById('ipfs-status-badge');
  if (badge) {
    const badgeState = getStatusBadgeState(status);
    badge.textContent = badgeState.text;
    badge.dataset.status = badgeState.value;
  }
}

function updateRadicleStatus(status, _error) {
  const badge = document.getElementById('radicle-status-badge');
  if (badge) {
    const badgeState = getStatusBadgeState(status);
    badge.textContent = badgeState.text;
    badge.dataset.status = badgeState.value;
  }
}

function updateSwarmWalletBalances(walletInfo) {
  if (swarmBalanceXdaiEl && walletInfo?.xdai !== undefined) {
    swarmBalanceXdaiEl.textContent = formatBalance(walletInfo.xdai);
  }
  if (swarmBalanceXbzzEl && walletInfo?.xbzz !== undefined) {
    swarmBalanceXbzzEl.textContent = formatBalance(walletInfo.xbzz);
  }
}

function updateSwarmStamps(stamps) {
  if (swarmStampsCount) {
    const count = Array.isArray(stamps) ? stamps.length : 0;
    swarmStampsCount.textContent = count.toString();
  }

  if (swarmStampsSummary) {
    if (!stamps || (Array.isArray(stamps) && stamps.length === 0)) {
      swarmStampsSummary.innerHTML = '<span class="node-stamps-empty">No stamps available</span>';
    } else if (Array.isArray(stamps)) {
      const totalCapacity = stamps.reduce((sum, s) => sum + (s.amount || 0), 0);
      swarmStampsSummary.innerHTML = `<span>Total capacity: ${formatBytes(totalCapacity)}</span>`;
    }
  }
}

// ============================================
// Wallet Notifications
// ============================================

function checkSwarmNotifications(status) {
  if (!walletNotification || !walletNotificationText || !walletNotificationAction) {
    return;
  }

  walletNotification.classList.add('hidden');

  if (!status?.running) return;

  if (status.wallet?.xdai !== undefined) {
    const xdaiBalance = parseFloat(status.wallet.xdai);
    if (xdaiBalance < 0.01) {
      showNotification('Swarm node needs xDAI for gas fees', 'Send xDAI', () =>
        handleSendToNode('xdai')
      );
      return;
    }
  }

  if (status.wallet?.xbzz !== undefined) {
    const xbzzBalance = parseFloat(status.wallet.xbzz);
    if (xbzzBalance < 0.1) {
      showNotification('Swarm node needs xBZZ for postage stamps', 'Send xBZZ', () =>
        handleSendToNode('xbzz')
      );
      return;
    }
  }

  if (status.stamps !== undefined) {
    const stampCount = Array.isArray(status.stamps) ? status.stamps.length : 0;
    if (stampCount === 0 && status.wallet?.xbzz && parseFloat(status.wallet.xbzz) > 0) {
      showNotification('No postage stamps available for uploads', 'Buy Stamps', () =>
        handleBuyStamps()
      );
    }
  }
}

function showNotification(message, actionLabel, actionHandler) {
  if (!walletNotification || !walletNotificationText || !walletNotificationAction) {
    return;
  }

  walletNotificationText.textContent = message;
  walletNotificationAction.textContent = actionLabel;

  // Remove old listener and add new one
  const newActionBtn = walletNotificationAction.cloneNode(true);
  walletNotificationAction.parentNode.replaceChild(newActionBtn, walletNotificationAction);
  walletNotificationAction = newActionBtn;
  walletNotificationAction.addEventListener('click', actionHandler);

  walletNotification.classList.remove('hidden');
}

function hideNotification() {
  if (walletNotification) {
    walletNotification.classList.add('hidden');
  }
}

function handleBuyStamps() {
  // TODO: Implement buy stamps flow
  console.log('[WalletUI] Buy stamps - coming soon');
  alert('Buy Postage Stamps - coming soon');
}
