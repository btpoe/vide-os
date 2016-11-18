const TransitionGroup = require('react-addons-css-transition-group');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const getHome = isWindows ? process.env.USERPROFILE: process.env.HOME;

const FILE_IMG = 'img/file.svg';
const FOLDER_IMG = 'img/folder.svg';

const stack = [];
const fileService = {
    get lastDirectory() {
        if (stack.length > 1) {
            stack.pop();
            return this.currentDirectory;
        }
        return false;
    },
    get currentDirectory() {
        return stack[stack.length - 1];
    },
    set currentDirectory(dirPath) {
        stack.push(dirPath);
    },
    get currentFiles() {
        const dirPath = this.currentDirectory;
        if (!dirPath) return [];

        return fs.readdirSync(dirPath)
            .filter(file => file.substring(0, 1) !== '.')
            .map(file => {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                return {
                    fileName: file,
                    fileSize: stats.size,
                    isFile: stats.isFile(),
                    fileModified: stats.mtime.toLocaleString(),
                    filePath
                };
            });
    },
    get stackCount() {
        return stack.length;
    }
};

function getSize(size) {
    let sizeKey = 'B';

    if (size > 999) {
        size /= 1000;
        sizeKey = 'K';
    }
    if (size > 999) {
        size /= 1000;
        sizeKey = 'M';
    }
    if (size > 999) {
        size /= 1000;
        sizeKey = 'G'
    }

    size = Math.round(size);
    return size + ' ' + sizeKey;
}

class Entry extends React.Component {
    constructor() {
        super();
        this.setSelected = this.setSelected.bind(this);
        this.openEntry = this.openEntry.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
    }

    setSelected(e) {
        console.log(e.nativeEvent);
        if (e.keyCode === 13) {
            this.openEntry();
        }
    }

    openEntry() {
        this.props.openEntry(this.props.isFile, this.props.filePath);
    }

    handleDragStart(e) {
        e.dataTransfer.setData('text/plain', this.props.filePath);
        const dragImage = new Image();
        dragImage.src = FILE_IMG;
        dragImage.width = 120;
        e.dataTransfer.setDragImage(dragImage, 0, 0);
    }

    render() {
        return React.createElement(
            'button',
            {
                className: 'Media-file Media-file--' + (this.props.isFile ? 'file' : 'directory'),
                onDoubleClick: this.openEntry,
                onKeyDown: this.setSelected,
                onDragStart: this.props.isFile ? this.handleDragStart : null,
                draggable: this.props.isFile
            },
            React.createElement('img', { className: 'filetype', src: this.props.isFile ? FILE_IMG : FOLDER_IMG, width: 120, height: 120 }),
            React.createElement('div', { className: 'filename' }, this.props.fileName),
            React.createElement('div', { className: 'filesize' }, getSize(this.props.fileSize)),
            React.createElement('div', { className: 'filemodified' }, this.props.fileModified)
        );
    }
}

class Header extends React.Component {
    constructor() {
        super();
        this.back = this.back.bind(this);
    }

    back() {
        const target = fileService.lastDirectory;
        if (target) {
            this.props.updateLayout();
        }
    }

    render() {
        return React.createElement(
            'header',
            null,
            React.createElement(
                'img',
                {
                    className: this.props.isBackable ? '' : 'is-inactive',
                    onClick: this.back,
                    src: 'img/arrow-back.svg'
                }
            ),
            React.createElement(
                TransitionGroup,
                {
                    transitionName: 'current-folder',
                    transitionEnterTimeout: 200,
                    transitionLeaveTimeout: 200
                },
                React.createElement('h2', { key: this.props.title }, this.props.title)
            )
        );
    }
}

class FileList extends React.Component {
    constructor() {
        super();

        this.openEntry = this.openEntry.bind(this);
    }

    openEntry(isFile, filePath) {
        if (isFile) {

        } else {
            fileService.currentDirectory = filePath;
            this.props.updateLayout();
            this.refs.fileList.scrollTop = 0;
        }
    }

    render() {
        const fileList = this.props.filesData.map((fileInfo, index) =>
            React.createElement(
                Entry,
                Object.assign({}, fileInfo, {
                    index,
                    openEntry: this.openEntry,
                    key: index
                })
            )
        );

        return React.createElement('div', { className: 'Media-fileList', ref: 'fileList' },
            fileList
        )
    }
}

class Media extends React.Component {
    constructor() {
        super();

        this.state = {
            filesData: fileService.currentFiles
        };

        this.updateLayout = this.updateLayout.bind(this);
    }

    componentDidMount() {
        fileService.currentDirectory = getHome;
        this.updateLayout();
    }

    updateLayout() {
        this.setState({ filesData: fileService.currentFiles });
    }

    render() {
        return React.createElement('div', { className: 'Media' },
            React.createElement(Header, { updateLayout: this.updateLayout, title: path.basename(fileService.currentDirectory || ''), isBackable: fileService.stackCount > 1 }),
            React.createElement(FileList, { updateLayout: this.updateLayout, filesData: this.state.filesData })
        )
    }
}

module.exports = Media;
