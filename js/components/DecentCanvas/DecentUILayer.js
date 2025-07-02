import './LeftToolbar.js';
import './RightToolbar.js';

console.log("🔧 DecentUILayer loaded");


// Add open-modal event listener for Mandelblum ship click on the component itself
document.addEventListener('DOMContentLoaded', () => {
    const component = document.querySelector('decent-ui-layer');
    if (!component) return;
    component.addEventListener('open-modal', () => {
        console.log("🚀 open-modal event triggered in DecentUILayer");

        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '50%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.padding = '30px';
        modal.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.95), rgba(0,0,50,0.85))';
        modal.style.border = '2px solid cyan';
        modal.style.borderRadius = '20px';
        modal.style.boxShadow = '0 0 20px cyan';
        modal.style.zIndex = '1000';
        modal.style.color = 'cyan';
        modal.style.fontFamily = 'monospace';
        modal.style.textAlign = 'center';

        modal.innerHTML = `
            <h2 style="margin-bottom: 20px;">🧭 Add Coordinate</h2>
            <label>X: <input id="coord-x" type="number" style="margin: 5px;" /></label><br/>
            <label>Y: <input id="coord-y" type="number" style="margin: 5px;" /></label><br/>
            <label>Image URL: <input id="coord-token" type="text" style="margin: 5px;" placeholder="https://...png" /></label><br/>
            <button id="add-plot" style="margin-top: 15px; padding: 6px 12px; background: black; color: cyan; border: 1px solid cyan;">Add</button>
            <button id="close-modal" style="margin-left: 10px; padding: 6px 12px; background: transparent; color: cyan; border: 1px solid cyan;">Close</button>
        `;

        document.body.appendChild(modal);

        document.getElementById('add-plot').onclick = () => {
            const x = parseFloat(document.getElementById('coord-x').value);
            const y = parseFloat(document.getElementById('coord-y').value);
            const token = document.getElementById('coord-token').value;

            component.dispatchEvent(new CustomEvent('add-plot', {
            detail: { x, y, token }
            }));

            document.body.removeChild(modal);
        };

        document.getElementById('close-modal').onclick = () => {
            document.body.removeChild(modal);
        };
    });

    component.addEventListener('open-nft-modal', (e) => {
        const { x, y, token } = e.detail;
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '50%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.padding = '30px';
        modal.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.95), rgba(0,0,50,0.85))';
        modal.style.border = '2px solid cyan';
        modal.style.borderRadius = '20px';
        modal.style.boxShadow = '0 0 20px cyan';
        modal.style.zIndex = '1000';
        modal.style.color = 'cyan';
        modal.style.fontFamily = 'monospace';
        modal.style.textAlign = 'center';

        modal.innerHTML = `
    <h2>📍 Plot Info</h2>
    <label>X: <input id="edit-x" type="number" value="${x}" style="margin: 5px;" /></label><br/>
    <label>Y: <input id="edit-y" type="number" value="${y}" style="margin: 5px;" /></label><br/>
    <label>Image URL: <input id="edit-token" type="text" value="${token}" style="margin: 5px;" /></label><br/>
    <button id="save-plot" style="margin-top: 10px; padding: 6px 12px; background: black; color: cyan; border: 1px solid cyan;">Save</button>
    <button id="close-nft-modal" style="margin-left: 10px; padding: 6px 12px; background: transparent; color: cyan; border: 1px solid cyan;">Close</button>
  `;

        document.body.appendChild(modal);

        document.getElementById('save-plot').onclick = () => {
          const newX = parseFloat(document.getElementById('edit-x').value);
          const newY = parseFloat(document.getElementById('edit-y').value);
          const newToken = document.getElementById('edit-token').value;

          console.log("📝 Updated plot info:", { newX, newY, newToken });
          // You can handle actual updates here if desired

          document.body.removeChild(modal);
        };

        document.getElementById('close-nft-modal').onclick = () => {
          document.body.removeChild(modal);
        };
    });

  const leftToolbar = document.createElement('left-toolbar');
  leftToolbar.style.position = 'absolute';
  leftToolbar.style.left = '0';
  leftToolbar.style.top = '0';
  leftToolbar.style.bottom = '0';
  leftToolbar.style.width = '50px';
  leftToolbar.style.zIndex = '999';
  component.appendChild(leftToolbar);

  const rightToolbar = document.createElement('right-toolbar');
  rightToolbar.style.position = 'absolute';
  rightToolbar.style.right = '0';
  rightToolbar.style.top = '0';
  rightToolbar.style.bottom = '0';
  rightToolbar.style.width = '50px';
  rightToolbar.style.zIndex = '999';
  component.appendChild(rightToolbar);
});
