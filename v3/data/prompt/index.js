const ports = [];
let selected = null;
let submitting = false;
let switching = 0;

const renderPending = () => {
  const box = document.getElementById('pending');
  const list = document.getElementById('pending-list');
  list.textContent = '';
  box.hidden = ports.length === 0;
  document.getElementById('count').textContent = ports.length;

  // newest tab first; count frames per tab
  const tabs = new Map();
  for (let n = ports.length - 1; n >= 0; n--) {
    const port = ports[n];
    const id = port.sender.tab ? port.sender.tab.id : port.sender.url;
    if (tabs.has(id) === false) {
      tabs.set(id, {
        url: port.sender.tab ? port.sender.tab.url : port.sender.url,
        tabId: port.sender.tab && port.sender.tab.id,
        windowId: port.sender.tab && port.sender.tab.windowId,
        count: 0
      });
    }
    tabs.get(id).count += 1;
  }

  for (const {url, tabId, windowId, count} of tabs.values()) {
    const row = document.createElement('div');
    row.className = 'pending-row';

    const span = document.createElement('span');
    span.textContent = url || 'Unknown origin';
    span.title = 'Click to focus this tab';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '×' + count;
    badge.hidden = count < 2;

    row.append(span, badge);
    row.onclick = () => {
      // suppress the always-on-top refocus while focus moves to the tab
      switching = Date.now() + 500;
      if (Number.isInteger(windowId)) {
        chrome.windows.update(windowId, {focused: true}).catch(() => {});
      }
      if (Number.isInteger(tabId)) {
        chrome.tabs.update(tabId, {active: true}).catch(() => {});
      }
    };
    list.append(row);
  }
};

const render = history => {
  const list = document.getElementById('list');
  list.textContent = '';
  for (const [latitude, longitude, name] of history) {
    const row = document.createElement('label');
    row.className = 'row';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'geo';
    input.value = [latitude, longitude, name].join(', ');
    input.onchange = () => {
      selected = input.value;
      document.getElementById('submit').disabled = false;
    };

    const span = document.createElement('span');
    span.textContent = latitude + ', ' + longitude + (name ? ' → ' + name : '');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'Remove this location from the stored list';
    remove.onclick = async () => {
      const prefs = await chrome.storage.local.get({history: []});
      await chrome.storage.local.set({
        history: prefs.history.filter(([a, b]) => a !== latitude || b !== longitude)
      });
      if (selected === input.value) {
        selected = null;
        document.getElementById('submit').disabled = true;
      }
    };

    row.append(input, span, remove);
    list.append(row);
  }
  document.getElementById('empty').hidden = history.length !== 0;
};

const select = value => {
  selected = value;
  document.getElementById('submit').disabled = false;
  for (const input of document.querySelectorAll('#list input[type=radio]')) {
    input.checked = input.value === value;
  }
};

{
  const init = async () => {
    const prefs = await chrome.storage.local.get({history: []});
    render(prefs.history);
  };
  init();
}

chrome.storage.onChanged.addListener(ps => {
  if (ps.history) {
    render(ps.history.newValue || []);
  }
});

const samples = [
  ['51.507368', '-0.127695', 'London'],
  ['40.712776', '-74.005974', 'New York'],
  ['35.689487', '139.691711', 'Tokyo'],
  ['48.856613', '2.352222', 'Paris'],
  ['55.755825', '37.617298', 'Moscow'],
  ['-33.868820', '151.209290', 'Sydney'],
  ['52.520008', '13.404954', 'Berlin'],
  ['41.902784', '12.496365', 'Rome'],
  ['37.774929', '-122.419416', 'San Francisco'],
  ['25.204849', '55.270783', 'Dubai']
];

document.getElementById('sample').onclick = () => {
  const [latitude, longitude, name] = samples[Math.floor(Math.random() * samples.length)];
  // shift the picked location a bit so every click inserts a new entry
  const offset = () => (Math.random() > 0.5 ? 1 : -1) * Math.random() * 0.01;
  const lat = (Number(latitude) + offset()).toFixed(6);
  const lng = (Number(longitude) + offset()).toFixed(6);
  document.getElementById('latitude').value = lat;
  document.getElementById('longitude').value = lng;
  document.getElementById('name').value = name + ' (random ' + Math.floor(Math.random() * 1000) + ')';
};

document.getElementById('add').onsubmit = async e => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  const latitude = document.getElementById('latitude').value.trim();
  const longitude = document.getElementById('longitude').value.trim();
  const name = document.getElementById('name').value.trim();

  try {
    if (!isFinite(latitude) || Math.abs(latitude) > 90) {
      throw Error('Latitude must be a number between -90 and 90');
    }
    if (!isFinite(longitude) || Math.abs(longitude) > 180) {
      throw Error('Longitude must a number between -180 and 180');
    }
    if ((latitude.split('.')[1] || '').length < 4 || (longitude.split('.')[1] || '').length < 4) {
      throw Error('At least 5 digits must appear after the decimal point. Example: 51.507368, -0.127695');
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const prefs = await chrome.storage.local.get({history: []});
    const n = prefs.history.findIndex(([a, b]) => a === lat && b === lng);
    if (n >= 0) {
      if (name) {
        prefs.history[n][2] = name;
      }
    }
    else {
      prefs.history.unshift([lat, lng, name]);
    }
    await chrome.storage.local.set({history: prefs.history.slice(0, 10)});

    document.getElementById('latitude').value = '';
    document.getElementById('longitude').value = '';
    document.getElementById('name').value = '';
    select([lat, lng, name].join(', '));
  }
  catch (e) {
    msg.textContent = e.message;
    msg.classList.add('error');
    setTimeout(() => {
      msg.classList.remove('error');
    }, 3000);
  }
};

document.getElementById('deny').onclick = () => {
  // closing resolves every pending port through onDisconnect which the
  // content script treats as an empty (denied) response
  submitting = true;
  window.close();
};

document.getElementById('submit').onclick = () => {
  if (!selected || submitting) {
    return;
  }
  submitting = true;
  for (const port of [...ports]) {
    port.postMessage(selected);
  }
  ports.length = 0;
  window.close();
};

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.method === 'ping-prompt') {
    respond(true);
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'geo-prompt') {
    return;
  }
  ports.push(port);
  renderPending();
  port.onDisconnect.addListener(() => {
    const n = ports.indexOf(port);
    if (n !== -1) {
      ports.splice(n, 1);
    }
    if (submitting === false) {
      renderPending();
    }
  });
});

window.addEventListener('blur', () => {
  if (submitting || Date.now() < switching) {
    return;
  }
  if (document.getElementById('blur').checked) {
    return;
  }
  chrome.runtime.sendMessage({method: 'focus-prompt'}).catch(() => {});
});
