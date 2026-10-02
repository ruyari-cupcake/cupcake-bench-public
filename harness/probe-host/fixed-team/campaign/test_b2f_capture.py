"""F5 capture symlinks are never a resumable evidence boundary."""
import subprocess
import unittest
from test_finish_resume import FinishResume


class CaptureSymlinks(unittest.TestCase):
    setUp = FinishResume.setUp
    capture = FinishResume.capture
    post = FinishResume.post
    def test_symlink_capture_refuses_before_grade_or_cleanup(self):
        self.capture()
        self.calls.clear()
        target = self.root / 'outside.txt'
        target.write_text('original')
        link = self.root / 'cells' / self.cell / 'main/link'
        link.symlink_to(target)
        for changed in (False, True):
            if changed:
                target.write_text('changed target without changing link')
            with self.subTest(changed=changed), self.assertRaisesRegex(SystemExit, 'symlink'):
                self.post(lambda *a, **k: self.calls.append('grade'))
            self.assertEqual(self.calls, [])
            self.assertEqual(target.read_text(), 'changed target without changing link' if changed else 'original')

    def test_symlink_added_after_failed_grade_refuses_resume(self):
        def partial(*args, **kwargs):
            raise subprocess.CalledProcessError(7, 'grade')
        with self.assertRaises(subprocess.CalledProcessError):
            self.post(partial)
        self.calls.clear()
        main = self.root / 'cells' / self.cell / 'main'
        (main / 'alias').symlink_to(main / 'submission.txt')
        with self.assertRaisesRegex(SystemExit, 'symlink'):
            self.post(lambda *a, **k: self.calls.append('grade'))
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
