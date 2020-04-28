'use strict';

const _ = require('underscore');
const $ = require('jquery');
const Backbone = require('backbone');
Backbone.$ = $;

const ERDM = require("element-resize-detector");
const RefTable = require('./refs');

const createItem = require('./create').createItem;
const formatIO = require('../common/utils/formatio');
const b64 = require('../common/utils/b64');
const Annotation = require('./annotation');

//require('./annotation');


class Main {  // this is constructed at the bottom

    constructor() {
        this.mainWindow = null;
        this.results = null;
        this.$results = null;
        this.resultsDefn = null;
        this.active = null;
        this._focus = 0;
        this._annotationFocused = false;
        this._annotationState = false;

        window.addEventListener('message', event => this._messageEvent(event));

        this._notifyResize = _.debounce(() => this._reallyNotifyResize(), 50);

        window.setOption = (name, value) => {
            this.mainWindow.postMessage({
                type : 'setOption',
                data : { name, value }}, '*');
        };

        window.setParam = (address, options) => {
            this.mainWindow.postMessage({
                type : 'setParam',
                data : { address, options }}, '*');
        };

        window.getParam = (address, name) => {
            let optionName = 'results/' + address.join('/') + '/' + name;
            if (optionName in this.resultsDefn.options)
                return this.resultsDefn.options[optionName];
        };

        window.openUrl = (url) => {
            this.mainWindow.postMessage({
                type : 'openUrl',
                data : { url: url }}, '*');
        };

        // the location of the script should be inside the body
        // so we don't need document.ready()
        this.$body = $('body');

        $(document).mousedown(this, (event) => this._mouseDown(event));
        $(document).mouseup(this, (event) => this._mouseUp(event));
        $(document).mousemove(this, (event) => this._mouseMove(event));

        document.body.addEventListener('contextmenu', (event) => {
            let clickEvent = $.Event('contextmenu');
            clickEvent.pageX = event.pageX;
            clickEvent.pageY = event.pageY;
            this.$results.trigger(clickEvent);
        });
    }

    _reallyNotifyResize() {
        let width  = this.$results.width()  + 40;
        let height = this.$results.height() + 25;

        this.mainWindow.postMessage({
            type : 'sizeChanged',
            data : { width: width, height: height }}, '*');
    }

    _sendMenuRequest(event) {
        let entries = event.data.entries;
        entries[0].type = 'Analysis';

        this.mainWindow.postMessage(event, '*');

        let lastEntry = entries[entries.length-1];
        this._menuEvent({ type: 'activated', address: lastEntry.address });
    }

    _sendAnnotationRequest(name, data) {
        let event = {
            type: name,
            data: data
        };

        this.mainWindow.postMessage(event, '*');
    }

    _messageEvent(event) {

        if (event.source === window)
            return;

        this.mainWindow = event.source;
        let hostEvent = event.data;
        let eventData = hostEvent.data;

        if (hostEvent.type === 'results') {
            this.resultsDefn = eventData;
            // ensure empty root results still display
            this.resultsDefn.results.visible = 2;
            this._render();
        }
        else if (hostEvent.type === 'reftablechanged') {
            if (this._refTable)
                this._refTable.setup(eventData.refs, eventData.refsMode);
        }
        else if (hostEvent.type === 'selected') {
            this._analysisSelected = eventData.state;
            if (this.$results) {
                if (this._analysisSelected === null)
                    this.$results.addClass('no-analysis-selected');
                else {
                    this.$results.removeClass('no-analysis-selected');
                    if (this._analysisSelected)
                        this.$results.addClass('analysis-selected');
                    else
                        this.$results.removeClass('analysis-selected');
                }
            }
        }
        else if (hostEvent.type === 'click') {
            let el = document.elementFromPoint(hostEvent.pageX, hostEvent.pageY);
            if (el === document.body)
                el = this.$results[0];
            let clickEvent = $.Event('contextmenu');
            clickEvent.pageX = hostEvent.pageX;
            clickEvent.pageY = hostEvent.pageY;
            $(el).trigger(clickEvent);
        }
        else if (hostEvent.type === 'addNote') {
            let address = eventData.address;
            let options = eventData.options;

            let annotation = Annotation.getControl(address, false);
            if (annotation !== null)
                annotation.focus(options.text);


        }
        else if (hostEvent.type === 'getcontent') {

            let address = eventData.address;
            let options = eventData.options;

            let node = this.results.el;
            for (let i = 0; i < address.length; i++)
                node = node.querySelectorAll(`[data-name="${ b64.enc(address[i]) }"]`)[0];

            let incHtml = this.resultsDefn.mode === 'rich';
            let incText = true;
            let incImage = false;

            if (node.classList.contains('jmv-results-syntax'))
                incHtml = false;

            if (node.classList.contains('jmv-results-image')) {
                incText = false;
                incImage = true;
            }

            let content = { };

            Promise.resolve().then(() => {

                if (incText)
                    return formatIO.exportElem(node, 'text/plain', options);

            }).then((text) => {

                if (text)
                    content.text = text;

                if (incImage)
                    return formatIO.exportElem(node, 'image/png', options);

            }).then((image) => {

                if (image)
                    content.image = image;

                if (incHtml)
                    return formatIO.exportElem(node, 'text/html', options);

            }).then((html) => {

                if (html)
                    content.html = html;

                let event = { type: 'getcontent', data: { content, address } };
                this.mainWindow.postMessage(event, '*');
            });
        }
        else if (hostEvent.type === 'menuEvent') {
            this._menuEvent(eventData);
        }
        else if (hostEvent.type === 'annotationEvent') {
            this._annotationEvent(eventData);
        }
    }

    _render() {
        Annotation.detach();

        this.$body.attr('data-mode', this.resultsDefn.mode);
        this.$body.empty();
        this.$body.off('annotation-editing');
        this.$body.off('annotation-lost-focus');

        this._refTable = new RefTable();
        this._refTable.setup(this.resultsDefn.refs, this.resultsDefn.refsMode);

        this.$results = $('<div id="results"></div>');
        this._updateAnnotationStates();
        this.results = createItem(
            this.resultsDefn.results,
            this.resultsDefn.options,
            this.$results,
            0,
            { _sendEvent: event => this._sendMenuRequest(event) },
            this.resultsDefn.mode,
            this.resultsDefn.devMode,
            this.resultsDefn.format,
            this._refTable);
        this.$results.appendTo(this.$body);

        this.$selector = $('<div id="selector"></div>').appendTo(this.$body);

        this.$body.on('annotation-editing', (event) => {
            this._focus += 1;
            if (this._focus === 1)
                this._sendAnnotationRequest('annotationFocus', event.annotationData);
        });

        this.$body.on('annotation-lost-focus', (event) => {
            this._focus -= 1;
            if (this._focus === 0)
                this._sendAnnotationRequest('annotationLostFocus', event.annotationData);
            else if (this._focus < 0)
                throw "shouldn't get here";
        });

        this.$body.on('annotation-formats', (event, data) => {
            this._sendAnnotationRequest('annotationFormats', event.detail.annotationData);
        });

        this.$body.on('annotation-changed', (event) => {
            this._sendAnnotationRequest('annotationChanged', event.annotationData);
        });

        $(document).ready(() => {
            let erd = ERDM({ strategy: 'scroll' });
            erd.listenTo(this.$results[0], (element) => {
                this._notifyResize();
            });
        });
    }

    _updateAnnotationStates() {
        if (this.$results) {
            if (this._annotationFocused)
                this.$results.addClass('edit-focus');
            else
                this.$results.removeClass('edit-focus');

            if (this._annotationState)
                this.$results.addClass('edit-state');
            else
                this.$results.removeClass('edit-state');
                
            if (this._analysisSelected === null)
                this.$results.addClass('no-analysis-selected');
            else {
                this.$results.removeClass('no-analysis-selected');
                if (this._analysisSelected)
                    this.$results.addClass('analysis-selected');
                else
                    this.$results.removeClass('analysis-selected');
            }
        }
    }

    _annotationEvent(event) {
        switch (event.type) {
            case 'editState':
                this._annotationState = event.state;
                if (this.$results) {
                    if (this._annotationState)
                        this.$results.addClass('edit-state');
                    else
                        this.$results.removeClass('edit-state');
                }
                break;
            case 'editFocused':
                this._annotationFocused = event.state;
                if (this.$results) {
                    if (this._annotationFocused)
                        this.$results.addClass('edit-focus');
                    else
                        this.$results.removeClass('edit-focus');
                }
                break;
            case 'action':
                for (let annotation of Annotation.controls) {
                    if (annotation.$el.hasClass('had-focus')) {
                        annotation.processToolbarAction(event.action);
                        break;
                    }
                }
                break;
        }
    }

    _menuEvent(event) {

        if (this.active !== null) {
            this.$selector.css('opacity', '0');
            this.active = null;
        }

        if (event.address === null)
            return;

        let address = event.address;

        if (address.length === 0) {
            this.active = this.results;
        }
        else {
            this.active = this.results.get(address);
        }

        switch (event.type) {
            case 'activated':
                let pos = this.active.$el.offset();
                let width = this.active.$el.outerWidth();
                let height = this.active.$el.outerHeight();
                let padTB = 0;
                let padLR = 12;

                if (this.active.$el.is(this.$results))
                    padTB = padLR = 0;

                this.$selector.css({
                    left:   pos.left - padLR,
                    top:    pos.top  - padTB,
                    width:  width  + 2 * padLR,
                    height: height + 2 * padTB,
                    opacity: 1 });
                break;
        }
    }

    _mouseUp(event) {
        let data = {
            eventName: "mouseup",
            which: event.which,
            pageX: event.pageX,
            pageY: event.pageY
        };

        if (this.mainWindow) {
            this.mainWindow.postMessage({
                type : 'mouseEvent',
                data : data}, '*');
        }
    }

    _mouseMove(event) {
        let data = {
            eventName: "mousemove",
            which: event.which,
            pageX: event.pageX,
            pageY: event.pageY
        };

        if (this.mainWindow) {
            this.mainWindow.postMessage({
                type : 'mouseEvent',
                data : data}, '*');
        }
    }

    _mouseDown(event) {
        let data = {
            eventName: "mousedown",
            which: event.which,
            pageX: event.pageX,
            pageY: event.pageY
        };

        if (this.mainWindow) {
            this.mainWindow.postMessage({
                type : 'mouseEvent',
                data : data}, '*');
        }
    }
}

new Main();  // constructed down here!
