const {Cu} = require('chrome');
Cu.import('resource://gre/modules/Services.jsm'); /* globals Services: false */
Cu.import('resource://gre/modules/Preferences.jsm'); /* globals Preferences */

const {AddonManager} = require('resource://gre/modules/AddonManager.jsm');
const tabs = require('sdk/tabs');
const {Panel: panel} = require('sdk/panel');
var data = require('sdk/self').data;

const panelWidth = 402;
const panelRecHeight = 102;

class Recommender {
  constructor() {
    this.doc = Services.wm.getMostRecentWindow('navigator:browser').document;
    this.installedAddonIds = new Set();
    this.recData = [];
  }

  start() {
    this.createPanel();
    this.createButton();
    this.createRequestListener('install');
    this.createRequestListener('uninstall');
    this.createWindowListener();
    this.populateInstallSet();
    this.loadLocalRecs();
  }

  destroy() {
    this.destroyPanel();
    this.destroyButton();
    this.removeWindowListener();
  }

  createPanel() {
    this.panel = panel({
      width: panelWidth,
      height: panelRecHeight,
      contentURL: './recommendation/recWindow.html',
      contentScriptFile: './recommendation/notify.js',
    });
  }

  destroyPanel() {
    this.panel.destroy();
  }

  createButton() {
    this.button = this.doc.createElement('div');
    this.button.id = 'recommend-button';
    this.buttonMessage = this.doc.createElement('h1');
    this.buttonMessage.style.background = '#00a920';
    this.buttonMessage.style.padding = '2px 6px';
    this.buttonMessage.style['border-radius'] = '3px';
    this.button.appendChild(this.buttonMessage);
    this.buttonImg = this.doc.createElement('image');
    this.buttonImg.setAttribute('class', 'urlbar-icon');
    this.button.appendChild(this.buttonImg);
    this.button.setAttribute('hidden', 'true');
    this.doc.getElementById('urlbar-icons').appendChild(this.button);

    this.button.addEventListener('click', this.showPanel.bind(this));
    this.setButton();
    this.watchButtonPrefs();
  }

  destroyButton() {
    this.button.remove();
  }

  setButton() {
    this.useTextButton = Preferences.get('extensions.@addon-rec.useTextButton');
    if(this.useTextButton) {
      this.setButtonText();
      this.buttonImg.setAttribute('hidden', 'true');
      this.buttonMessage.setAttribute('hidden', 'false');
    } else {
      this.setButtonImg();
      this.buttonMessage.setAttribute('hidden', 'true');
      this.buttonImg.setAttribute('hidden', 'false');
    }
  }

  setButtonText() {
    var customText = Preferences.get('extensions.@addon-rec.customButtonText');
    if(customText !== undefined && customText !== '') {
      this.buttonMessage.innerHTML = customText;
    } else {
      this.buttonMessage.innerHTML = 'Recommended Addons';
    }
  }

  setButtonImg() {
    var customImgURL = Preferences.get('extensions.@addon-rec.customButtonImgURL');
    if(customImgURL !== undefined && customImgURL !== '') {
      this.buttonImg.setAttribute('src', customImgURL);
    } else {
      this.buttonImg.setAttribute('src', data.url('recommendation/icon.svg'));
    }
  }

  watchButtonPrefs() {
    Preferences.observe('extensions.@addon-rec.useTextButton',
                        this.setButton.bind(this));
    Preferences.observe('extensions.@addon-rec.customButtonText',
                        this.setButtonText.bind(this));
    Preferences.observe('extensions.@addon-rec.customButtonImgURL',
                        this.setButtonImg.bind(this));
  }

  showPanel() {
    var windowRect = this.button.getBoundingClientRect();
    var panelPosition = windowRect.left - this.panel.width/2;
    this.panel.show({
      position: {
        top: 0,
        left: panelPosition,
      },
    });
  }

  showButton() {
    this.button.setAttribute('hidden', 'false');
  }

  hideButton() {
    this.button.setAttribute('hidden', 'true');
  }

  //Prepares panel with info in background
  prepPanel(rec) {
    this.panel.height =  rec.length * panelRecHeight;
    this.panel.port.emit('data', rec);
  }

  //adds all installed addon names to global set "installedAddons"
  populateInstallSet() {
    this.installedAddonIds.clear(); //to remove recently uninstalled addons
    AddonManager.getAllAddons( addons => {
      for(var addon of addons) {
        this.installedAddonIds.add(addon.id);
      }
    });
  }

  //checks to see if any recommendations are already installed
  checkForInstalled(recs) {
    for(var rec of recs) {
      if(this.installedAddonIds.has(rec.id)) {
        rec.isInstalled = true;
      } else {
        rec.isInstalled = false;
      }
    }
  }

  show(recs) {
    this.checkForInstalled(recs);
    this.prepPanel(recs);
    this.showButton();
  }

  //Checks that current window is target domain
  waitForWindow(tab) {
    for(var rec of this.recData) {
      if(tab.url.includes(rec.domain)) {
        this.show(rec.data);
        return;
      }
    }
    this.hideButton(); //only reached if none of rec domains match
  }

  installAddon(url) {
    AddonManager.getInstallForURL(url, installObject => {
      installObject.install();
      installObject.addListener({
        onInstallEnded: () => {
          this.populateInstallSet();
          var successMessage = 'install' + url;
          this.panel.port.emit(successMessage);
        },
      });
    }, 'application/x-xpinstall');
  }

  uninstallAddon(id, url) {
    AddonManager.getAddonByID(id, addon => {
      addon.uninstall();
      this.populateInstallSet();
      var successMessage = 'uninstall' + url;
      this.panel.port.emit(successMessage);
    });
  }

  createRequestListener(request) {
    if(request === 'install') {
      this.panel.port.on(request, data => {
        this.installAddon(data.packageURL);
      });
    }
    else if(request === 'uninstall') {
      this.panel.port.on(request, data => {
        this.uninstallAddon(data.id, data.packageURL);
      });
    }
  }

  createWindowListener() {
    tabs.on('activate', this.waitForWindow.bind(this));
    tabs.on('ready', this.waitForWindow.bind(this));
  }

  removeWindowListener() {
    tabs.off('activate', this.waitForWindow.bind(this));
    tabs.off('ready', this.waitForWindow.bind(this));
  }

  addRecommendation(domain, data) {
    const rec = {domain, data};
    this.recData.push(rec);
  }

  loadLocalRecs() {
    var recs = data.load('recommendation/localData.json');
    recs = JSON.parse(recs);
    for(var rec of recs) {
      this.addRecommendation(rec.domain, rec.data);
    }
  }
}

var recommender = new Recommender();

exports.Recommend = {
  start() {
    recommender.start();
  },
};
