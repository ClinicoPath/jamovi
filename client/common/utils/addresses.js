
'use strict';

module.exports = {

    flatten: function(arr) {
        return arr.join('/');
    },

    unflatten: function(str) {
        // equivalent to str.split('/'), except ignores / inside quotes
        return str.match(/"[^"]+"|([^/]+)/g);
    },
};
