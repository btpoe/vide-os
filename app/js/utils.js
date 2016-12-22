module.exports = {
    same(obj1, obj2, prop) {
        if (Array.isArray(prop)) {
            return prop.every(p => obj1[p] === obj2[p]);
        }
        return obj1[prop] === obj2[prop];
    }
};
