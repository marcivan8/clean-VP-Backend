import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE, DUR } from './motion';

/**
 * Reveals its children once, when the element scrolls into view.
 * Honours prefers-reduced-motion by rendering in place with no transform.
 */
export const Reveal = ({
    as = 'div', delay = 0, y = 18, children, className, style, ...rest
}) => {
    const still = useReducedMotion();
    const Tag = motion[as] || motion.div;

    return (
        <Tag
            className={className}
            style={style}
            initial={still ? false : { opacity: 0, y }}
            whileInView={still ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: DUR, ease: EASE, delay }}
            {...rest}
        >
            {children}
        </Tag>
    );
};

/**
 * Parent for a list whose items should arrive one after another.
 * Pair with <StaggerItem> children.
 */
export const Stagger = ({
    as = 'div', step = 0.12, delay = 0.05, children, className, style, ...rest
}) => {
    const still = useReducedMotion();
    const Tag = motion[as] || motion.div;

    return (
        <Tag
            className={className}
            style={style}
            initial={still ? false : 'hidden'}
            whileInView={still ? undefined : 'shown'}
            viewport={{ once: true, amount: 0.25 }}
            variants={{
                hidden: {},
                shown: { transition: { staggerChildren: step, delayChildren: delay } },
            }}
            {...rest}
        >
            {children}
        </Tag>
    );
};

export const StaggerItem = ({ as = 'div', y = 20, children, className, style, ...rest }) => {
    const still = useReducedMotion();
    const Tag = motion[as] || motion.div;

    return (
        <Tag
            className={className}
            style={style}
            variants={still ? undefined : {
                hidden: { opacity: 0, y },
                shown: { opacity: 1, y: 0, transition: { duration: DUR, ease: EASE } },
            }}
            {...rest}
        >
            {children}
        </Tag>
    );
};

/**
 * A bar that grows to `width` once in view. Used to show a duration
 * shrinking rather than to decorate.
 */
export const GrowBar = ({ width, delay = 0, duration = 0.9, style, children }) => {
    const still = useReducedMotion();

    return (
        <motion.div
            style={style}
            initial={still ? false : { width: 0 }}
            whileInView={still ? undefined : { width }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration, ease: EASE, delay }}
        >
            {children}
        </motion.div>
    );
};

export default Reveal;
