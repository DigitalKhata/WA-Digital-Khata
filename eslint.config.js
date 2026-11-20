import firebaseSecurityRules from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ...firebaseSecurityRules.configs['flat/recommended'],
    files: ['**/*.rules'],
  },
];
