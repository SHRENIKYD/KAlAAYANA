"""Fail closed before any production or rollback action."""
import os
import re
import subprocess


def validate(ref, freeze, tag=None):
    if ref != 'refs/heads/main':
        raise ValueError('Production workflows may run only from main')
    if freeze is not None:
        raise ValueError('Production remains frozen while FREEZE exists on develop; reviewed removal is required')
    if tag is not None and not re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.\d{1,2}', tag):
        raise ValueError('Rollback requires a release tag such as v1.2.16')


def main():
    subprocess.run(['git', 'fetch', '--no-tags', 'origin', '+refs/heads/develop:refs/remotes/origin/develop'], check=True)
    files = subprocess.check_output(['git', 'ls-tree', '--name-only', 'origin/develop', '--', 'FREEZE'], text=True)
    tag = os.environ.get('ROLLBACK_TAG')
    validate(os.environ.get('GITHUB_REF', ''), files.strip() or None, tag)
    if tag is not None:
        subprocess.run(['git', 'fetch', '--no-tags', 'origin', f'refs/tags/{tag}:refs/tags/{tag}'], check=True)
        subprocess.run(['git', 'rev-parse', '--verify', f'refs/tags/{tag}^{{commit}}'], check=True)


if __name__ == '__main__':
    main()
