const { app, BrowserWindow, Menu } = require('electron');
const template = require('./menu-template');

const menu = Menu.buildFromTemplate(template);

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 9999,
        height: 9999,
        minWidth: 800,
        minHeight: 600,
    });

    mainWindow.loadURL(`file://${__dirname}/index.html`);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', function () {
        mainWindow = null
    })
}
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow()
    }
});
