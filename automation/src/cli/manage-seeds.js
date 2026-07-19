// Interactive seed-list manager (menu UI). The actual mutations live in
// seed-store.js; this file is just the inquirer front-end. inquirer is required
// lazily inside run() so seed-store stays testable without a TTY.

const path = require('path');
const store = require('./seed-store');
const { seedGroups } = require('./seed-templates');

function printHeader(seeds) {
  const preview = seeds.length
    ? ` (${seeds.slice(0, 5).join(', ')}${seeds.length > 5 ? ', …' : ''})`
    : '';
  console.log('\n── Tour Manager Seed List Manager ──');
  console.log(`Current seeds: ${seeds.length}${preview}\n`);
}

async function doAdd(inquirer) {
  const { name } = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Artist name?' }]);
  const res = store.addSeed(name);
  if (res.ok) console.log(`✓ Added "${res.name}" (now ${res.seeds.length} seeds)`);
  else if (res.reason === 'empty') console.log('✗ Name cannot be empty.');
  else if (res.reason === 'duplicate') console.log(`✗ "${res.name}" is already in the list (${res.seeds.length} seeds).`);
}

function doView() {
  const seeds = store.listSeeds();
  if (!seeds.length) {
    console.log('Current seeds: (none)');
    return;
  }
  console.log(`Current seeds (${seeds.length}):\n`);
  seeds.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

async function doRemove(inquirer) {
  const seeds = store.listSeeds();
  if (!seeds.length) {
    console.log('No seeds to remove.');
    return;
  }
  const { pick } = await inquirer.prompt([{
    type: 'list',
    name: 'pick',
    message: 'Remove which artist?',
    choices: [...seeds, new inquirer.Separator(), 'Cancel'],
  }]);
  if (pick === 'Cancel') return;

  const res = store.removeSeed(pick);
  if (res.ok) console.log(`✓ Removed "${res.name}" (now ${res.seeds.length} seeds)`);
  else if (res.reason === 'last-seed') console.log('✗ Can\'t remove the last seed. Use "Clear all seeds" to empty the list.');
  else if (res.reason === 'not-found') console.log(`✗ "${res.name}" not found.`);
}

async function doClear(inquirer) {
  const seeds = store.listSeeds();
  if (!seeds.length) {
    console.log('List is already empty.');
    return;
  }
  const { sure } = await inquirer.prompt([{
    type: 'confirm',
    name: 'sure',
    message: `Clear ALL ${seeds.length} seeds? This can't be undone (a config.json.bak is kept).`,
    default: false,
  }]);
  if (!sure) {
    console.log('Cancelled.');
    return;
  }
  store.clearSeeds();
  console.log('✓ Cleared all seeds (0). Add at least one before running the pipeline.');
}

async function doExport(inquirer) {
  const seeds = store.listSeeds();
  const stamp = new Date().toISOString().slice(0, 10);
  const defaultPath = path.join(store.DEFAULT_CONFIG_PATH, '..', 'data', `seeds-backup-${stamp}.txt`);
  const { filePath } = await inquirer.prompt([{
    type: 'input',
    name: 'filePath',
    message: 'Export to file:',
    default: path.normalize(defaultPath),
  }]);
  const res = store.exportSeeds(filePath);
  console.log(`✓ Exported ${res.count} seed(s) to ${res.filePath}`);
}

async function doTemplate(inquirer) {
  const groupNames = Object.keys(seedGroups);
  if (!groupNames.length) {
    console.log('No templates defined.');
    return;
  }
  const { group } = await inquirer.prompt([{
    type: 'list',
    name: 'group',
    message: 'Quick-add which template group?',
    choices: [
      ...groupNames.map((g) => ({ name: `${g} (${seedGroups[g].length}): ${seedGroups[g].join(', ')}`, value: g })),
      new inquirer.Separator(),
      'Cancel',
    ],
  }]);
  if (group === 'Cancel') return;

  const res = store.importGroup(seedGroups[group]);
  console.log(
    `✓ Added ${res.added.length}${res.skipped.length ? `, skipped ${res.skipped.length} duplicate(s)` : ''} (now ${res.seeds.length} seeds)`
  );
}

async function run() {
  const inquirer = require('inquirer'); // lazy: keeps seed-store testable without a TTY

  for (;;) {
    printHeader(store.listSeeds());
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { name: '1. Add seed artist', value: 'add' },
        { name: '2. View all seeds', value: 'view' },
        { name: '3. Remove seed artist', value: 'remove' },
        { name: '4. Clear all seeds', value: 'clear' },
        { name: '5. Export seeds', value: 'export' },
        { name: '6. Quick-add from template', value: 'template' },
        { name: '7. Exit', value: 'exit' },
      ],
    }]);

    if (action === 'exit') {
      console.log('Goodbye!');
      return;
    }
    if (action === 'add') await doAdd(inquirer);
    else if (action === 'view') doView();
    else if (action === 'remove') await doRemove(inquirer);
    else if (action === 'clear') await doClear(inquirer);
    else if (action === 'export') await doExport(inquirer);
    else if (action === 'template') await doTemplate(inquirer);
  }
}

module.exports = { run, printHeader };
