/**
 * ImmutableUtils.js
 * Utilities for safe, immutable state updates.
 * All functions return new objects without mutating the original.
 */

// ============================================================================
// DEEP FREEZE - Ensure immutability in development
// ============================================================================

/**
 * Deep freeze an object to prevent mutations (development only)
 */
export function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    // Don't freeze in production for performance
    if (process.env.NODE_ENV === 'production') {
        return obj;
    }

    Object.freeze(obj);

    Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    });

    return obj;
}

// ============================================================================
// PATH-BASED UPDATES
// ============================================================================

/**
 * Get a value at a path in an object
 * @param {object} obj - Source object
 * @param {string[]} path - Array of keys
 * @returns {*} Value at path or undefined
 */
export function getIn(obj, path) {
    if (!path || path.length === 0) return obj;

    let current = obj;
    for (const key of path) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

/**
 * Set a value at a path, returning a new object
 * @param {object} obj - Source object
 * @param {string[]} path - Array of keys
 * @param {*} value - Value to set
 * @returns {object} New object with updated value
 */
export function setIn(obj, path, value) {
    if (!path || path.length === 0) {
        return value;
    }

    const [head, ...tail] = path;
    const current = obj || {};

    return {
        ...current,
        [head]: tail.length === 0
            ? value
            : setIn(current[head], tail, value)
    };
}

/**
 * Update a value at a path using an updater function
 * @param {object} obj - Source object
 * @param {string[]} path - Array of keys
 * @param {function} updater - Function that receives current value and returns new value
 * @returns {object} New object with updated value
 */
export function updateIn(obj, path, updater) {
    const currentValue = getIn(obj, path);
    const newValue = updater(currentValue);
    return setIn(obj, path, newValue);
}

/**
 * Delete a value at a path, returning a new object
 * @param {object} obj - Source object
 * @param {string[]} path - Array of keys
 * @returns {object} New object with value removed
 */
export function deleteIn(obj, path) {
    if (!path || path.length === 0) {
        return obj;
    }

    if (path.length === 1) {
        const { [path[0]]: removed, ...rest } = obj || {};
        return rest;
    }

    const [head, ...tail] = path;
    const current = obj || {};

    if (!(head in current)) {
        return current;
    }

    return {
        ...current,
        [head]: deleteIn(current[head], tail)
    };
}

// ============================================================================
// DEEP MERGE
// ============================================================================

/**
 * Deep merge two objects
 * @param {object} target - Target object
 * @param {object} source - Source object to merge
 * @returns {object} New merged object
 */
export function mergeDeep(target, source) {
    if (!source) return target;
    if (!target) return source;

    const output = { ...target };

    Object.keys(source).forEach(key => {
        const targetValue = target[key];
        const sourceValue = source[key];

        if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
            output[key] = mergeDeep(targetValue, sourceValue);
        } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
            output[key] = [...sourceValue]; // Replace arrays, don't merge
        } else {
            output[key] = sourceValue;
        }
    });

    return output;
}

/**
 * Check if value is a plain object
 */
function isPlainObject(value) {
    return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) === '[object Object]';
}

// ============================================================================
// ENTITY OPERATIONS
// ============================================================================

/**
 * Add an entity to the state
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type (e.g., 'clips', 'layers')
 * @param {object} entity - Entity to add
 * @returns {object} New state with entity added
 */
export function addEntity(state, entityType, entity) {
    if (!entity.id) {
        throw new Error(`Entity must have an id`);
    }

    return setIn(state, ['entities', entityType, entity.id], entity);
}

/**
 * Update an entity in the state
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @param {object} updates - Partial updates to apply
 * @returns {object} New state with entity updated
 */
export function updateEntity(state, entityType, entityId, updates) {
    const existing = getIn(state, ['entities', entityType, entityId]);

    if (!existing) {
        console.warn(`Entity not found: ${entityType}/${entityId}`);
        return state;
    }

    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    return setIn(state, ['entities', entityType, entityId], updated);
}

/**
 * Remove an entity from the state
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @returns {object} New state with entity removed
 */
export function removeEntity(state, entityType, entityId) {
    return deleteIn(state, ['entities', entityType, entityId]);
}

/**
 * Get an entity from the state
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @returns {object|undefined} Entity or undefined
 */
export function getEntity(state, entityType, entityId) {
    return getIn(state, ['entities', entityType, entityId]);
}

/**
 * Get all entities of a type
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type
 * @returns {object} Object map of entities
 */
export function getEntitiesByType(state, entityType) {
    return getIn(state, ['entities', entityType]) || {};
}

/**
 * Get all entities of a type as an array
 * @param {object} state - Timeline state
 * @param {string} entityType - Entity type
 * @returns {Array} Array of entities
 */
export function getEntitiesArray(state, entityType) {
    return Object.values(getEntitiesByType(state, entityType));
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Apply multiple operations in sequence
 * @param {object} state - Initial state
 * @param {Array} operations - Array of operation objects
 * @returns {object} Final state after all operations
 * 
 * Operation format:
 * { type: 'add' | 'update' | 'remove', entityType: string, entity?: object, entityId?: string, updates?: object }
 */
export function batchUpdate(state, operations) {
    return operations.reduce((currentState, op) => {
        switch (op.type) {
            case 'add':
                return addEntity(currentState, op.entityType, op.entity);
            case 'update':
                return updateEntity(currentState, op.entityType, op.entityId, op.updates);
            case 'remove':
                return removeEntity(currentState, op.entityType, op.entityId);
            case 'set':
                return setIn(currentState, op.path, op.value);
            default:
                console.warn(`Unknown batch operation type: ${op.type}`);
                return currentState;
        }
    }, state);
}

// ============================================================================
// ARRAY HELPERS
// ============================================================================

/**
 * Add an item to an array immutably
 */
export function arrayPush(arr, item) {
    return [...arr, item];
}

/**
 * Remove an item from an array by index
 */
export function arrayRemoveAt(arr, index) {
    return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

/**
 * Update an item in an array by index
 */
export function arrayUpdateAt(arr, index, updater) {
    return arr.map((item, i) => i === index ? updater(item) : item);
}

/**
 * Remove items from an array by predicate
 */
export function arrayRemoveWhere(arr, predicate) {
    return arr.filter((item, index) => !predicate(item, index));
}

/**
 * Insert an item at a specific index
 */
export function arrayInsertAt(arr, index, item) {
    return [...arr.slice(0, index), item, ...arr.slice(index)];
}

// ============================================================================
// CLONE UTILITIES
// ============================================================================

/**
 * Shallow clone an object
 */
export function shallowClone(obj) {
    if (Array.isArray(obj)) {
        return [...obj];
    }
    return { ...obj };
}

/**
 * Deep clone an object (use sparingly, prefer immutable updates)
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }

    const cloned = {};
    Object.keys(obj).forEach(key => {
        cloned[key] = deepClone(obj[key]);
    });
    return cloned;
}

export default {
    deepFreeze,
    getIn,
    setIn,
    updateIn,
    deleteIn,
    mergeDeep,
    addEntity,
    updateEntity,
    removeEntity,
    getEntity,
    getEntitiesByType,
    getEntitiesArray,
    batchUpdate,
    arrayPush,
    arrayRemoveAt,
    arrayUpdateAt,
    arrayRemoveWhere,
    arrayInsertAt,
    shallowClone,
    deepClone
};
