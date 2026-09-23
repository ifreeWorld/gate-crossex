# AGENTS.md

## Language

Always respond in Chinese (中文).

方案、设计文档、实施计划以及其他过程文档统一使用中文编写。

## 代码提交规范

帮我提交代码，步骤如下：

1. 判断当前分支是否是main，如果是main，就checkout -b zilong/{feature-name} 分支，{feature-name} 可以根据实际的改动来动态命名，如果不是main，就commit push
2. commit push
3. 调用github cli发起PR合并到main

注意：

1. 不要改完就立马提交代码，我让你提交你再提交，提交的时候，提交 message 里不要有 Generated with Codex这样的内容
2. 我说提交代码，就是指的是提交当前 git 仓库的所有改动，除非我特别说只提交哪一部分，不然你就按照全部提交来理解
