import { motion, useReducedMotion } from 'motion/react';

/**
 * One-shot entry for page sections: they arrive in reading order instead of all at once,
 * so the eye lands on the remote first. Static under reduced motion.
 */
export default function Reveal({ index = 0, as = 'div', className = '', children, ...rest }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20, delay: reduce ? 0 : 0.06 * index }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
