import unittest
from deploy_guard import validate


class DeployGuardTests(unittest.TestCase):
    def test_main_unfrozen(self):
        validate('refs/heads/main', None, 'v1.2.16')

    def test_other_refs_blocked(self):
        for ref in ('refs/heads/develop', 'refs/tags/v1.2.16', ''):
            with self.assertRaises(ValueError):
                validate(ref, None)

    def test_freeze_never_expires_automatically(self):
        for freeze in ('2026-11-07', '2000-01-01', 'invalid'):
            with self.assertRaises(ValueError):
                validate('refs/heads/main', freeze)

    def test_untrusted_tag_rejected(self):
        for tag in ('main', 'v1.2.16; echo unsafe', '$(echo unsafe)', '../main', '-x', ''):
            with self.assertRaises(ValueError):
                validate('refs/heads/main', None, tag)


if __name__ == '__main__':
    unittest.main()
