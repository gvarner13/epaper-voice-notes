import unittest
from grok_coverage import coverage, normalized

class CoverageTests(unittest.TestCase):
    def test_formatting_differences_preserve_all_tokens(self):
        self.assertEqual(normalized("Checkpoint number 21. First, elapsed time is 60 seconds."),
                         normalized("Checkpoint number twenty-one: 1st, elapsed time is 60 s."))

    def test_missing_or_rewritten_passages_fail(self):
        slots = [{"text": "Checkpoint number 1. We should check the water pipes."}]
        for actual in ("Checkpoint number one. We should check.", "Checkpoint number one. We should check the gas pipes."):
            self.assertFalse(coverage(actual, slots)["all_normalized_words_match"])

    def test_missing_repeated_passages_and_reordered_checkpoints_fail(self):
        slots = [{"text": "Checkpoint number 1. Hello."}, {"text": "Checkpoint number 2. Hello."}]
        report = coverage("Checkpoint number two. Hello. Checkpoint number one. Hello.", slots)
        self.assertFalse(report["checkpoints_in_order"])
        self.assertFalse(report["all_normalized_words_match"])
        self.assertFalse(coverage("Checkpoint number one. Hello. Checkpoint number two.", slots)["all_normalized_words_match"])

    def test_normalization_does_not_mask_numeric_errors(self):
        self.assertNotEqual(normalized("Elapsed time is 30 seconds."), normalized("Elapsed time is 60 s."))

    def test_silence_requires_empty_text_not_polite_hallucinations(self):
        self.assertTrue(coverage("", [])["all_normalized_words_match"])
        self.assertFalse(coverage("Thank you.", [])["all_normalized_words_match"])
        self.assertFalse(coverage("...", [])["passed"])

if __name__ == "__main__":
    unittest.main()
