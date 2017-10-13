function indexOf(iteratee, array, target) {
    let min = 0;
    let max = array.length - 1;

    while(min <= max) {
        let index = Math.floor((max + min) / 2);
        const result = iteratee(array[index], target);

        if (result === 0) {
            while(array[index] === array[index - 1]) {
                index--;
            }
            return index;
        }
        else if (result === -1) {
            max = index - 1;
        }
        else {
            min = index + 1;
        }
    }

    return -1;
}

function find(iteratee, array, target) {
    const index = indexOf(iteratee, array, target);
    if (index === -1) {
        return null;
    }
    return array[index];
}

module.exports = { indexOf, find };
