/** Synthetic page behavior compiled before fixture assembly. */
export function installDomTable(){

  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('#inventory input'));
  const status = document.getElementById('status')!;
  const markDirty = () => { status.dataset.dirty = 'true'; status.textContent = 'Unsaved changes'; };
  inputs.forEach(input => input.addEventListener('input', markDirty));
  document.getElementById('save')!.addEventListener('click', () => {
    const totals = inputs.map(input => input.value.trim());
    // A save is only accepted when every quantity is a positive number.
    const invalid = totals.filter(value => !/^\d+$/.test(value) || Number(value) <= 0);
    if (invalid.length > 0) {
      status.dataset.dirty = 'true';
      status.textContent = 'Save refused: quantities must be positive whole numbers';
      return;
    }
    status.dataset.dirty = 'false';
    status.textContent = 'Saved ' + totals.join(',') + ' at ' + new Date().toISOString();
  });
  document.getElementById('reload')!.addEventListener('click', () => { location.reload(); });

}
