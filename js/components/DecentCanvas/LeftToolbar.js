class LeftToolbar extends HTMLElement {
  connectedCallback() {
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.alignItems = 'center';
    this.style.justifyContent = 'space-between';
    this.style.width = '50px';
    this.style.background = 'rgba(0, 0, 0, 0.6)';
    this.style.left = '0';
    this.style.zIndex = '999';
    this.style.padding = '20px 0';

    const buttonCount = 6;
    for (let i = 0; i < buttonCount; i++) {
      const btn = document.createElement('button');
      btn.style.width = '36px';
      btn.style.height = '36px';
      btn.style.borderRadius = '50%';
      btn.style.border = '1px solid orange';
      btn.style.background = 'black';
      btn.style.boxShadow = '0 0 10px orange';
      btn.style.cursor = 'pointer';
      btn.innerHTML = `🔆`;
      btn.dataset.modal = `modal-left-${i + 1}`;
      btn.addEventListener('click', (e) => {
        this.showModal(e.target.dataset.modal);
      });
      this.appendChild(btn);
    }
  }

  showModal(id) {
    // 🧹 Remove any existing modals
    const existingModals = document.querySelectorAll('[id^="modal-"]');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.id = id;
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.padding = '20px';
    modal.style.background = 'rgba(0, 0, 0, 0.9)';
    modal.style.border = '2px solid magenta';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 0 20px magenta';
    modal.style.zIndex = '2000';
    modal.style.color = 'white';
    modal.style.fontFamily = 'monospace';
    modal.style.textAlign = 'center';

    modal.innerHTML = `
      <h3>Modal: ${id}</h3>
      <p>This is a placeholder for <strong>${id}</strong></p>
      <button style="margin-top: 10px; padding: 6px 12px; border: 1px solid magenta; background: black; color: magenta;" onclick="document.body.removeChild(document.getElementById('${id}'))">Close</button>
    `;

    document.body.appendChild(modal);
  }
}

customElements.define('decent-left-toolbar', LeftToolbar);